import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

/// Renders a "coach clip": the recorded workout video with the skeleton,
/// rep counter, form cue and FormUp branding burned into every frame.
public class CoachClipModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CoachClip")

    AsyncFunction("renderAsync") { (inputUri: String, specJson: String, outputUri: String, promise: Promise) in
      guard let inputURL = Self.fileURL(inputUri), let outputURL = Self.fileURL(outputUri) else {
        promise.reject("ERR_COACH_CLIP_PATH", "Invalid input or output path")
        return
      }
      let spec: ClipSpec
      do {
        spec = try JSONDecoder().decode(ClipSpec.self, from: Data(specJson.utf8))
      } catch {
        promise.reject("ERR_COACH_CLIP_SPEC", "Could not read the overlay timeline: \(error.localizedDescription)")
        return
      }
      Self.render(input: inputURL, output: outputURL, spec: spec) { result in
        switch result {
        case .success(let url): promise.resolve(url.absoluteString)
        case .failure(let error): promise.reject("ERR_COACH_CLIP_RENDER", error.localizedDescription)
        }
      }
    }
  }

  private static func fileURL(_ uri: String) -> URL? {
    if uri.hasPrefix("file://") { return URL(string: uri) }
    return URL(fileURLWithPath: uri)
  }

  private static func render(
    input: URL, output: URL, spec: ClipSpec, completion: @escaping (Result<URL, Error>) -> Void
  ) {
    let asset = AVURLAsset(url: input)
    try? FileManager.default.removeItem(at: output)

    let painter = OverlayPainter(spec: spec)
    // The CI-filter composition applies the track's preferredTransform, so
    // sourceImage arrives upright and renderSize is the upright size.
    let composition = AVMutableVideoComposition(asset: asset) { request in
      let source = request.sourceImage.clampedToExtent()
      let extent = request.sourceImage.extent
      let seconds = CMTimeGetSeconds(request.compositionTime)
      if let overlay = painter.overlay(at: seconds, size: extent.size) {
        let out = overlay.transformed(by: CGAffineTransform(translationX: extent.origin.x, y: extent.origin.y))
          .composited(over: source)
          .cropped(to: extent)
        request.finish(with: out, context: nil)
      } else {
        request.finish(with: source.cropped(to: extent), context: nil)
      }
    }

    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      completion(.failure(ClipError.message("Could not start the video export")))
      return
    }
    export.outputURL = output
    export.outputFileType = .mp4
    export.videoComposition = composition
    export.shouldOptimizeForNetworkUse = true
    export.exportAsynchronously {
      switch export.status {
      case .completed: completion(.success(output))
      default:
        completion(.failure(export.error ?? ClipError.message("Video export failed (\(export.status.rawValue))")))
      }
    }
  }
}

enum ClipError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    if case .message(let m) = self { return m }
    return nil
  }
}

struct ClipFrame: Decodable {
  let t: Double
  let pts: [Double]
  let reps: Int
  let target: Int
  let cue: String
  let tone: String
  let goodFlash: Bool
}

struct ClipSpec: Decodable {
  let frames: [ClipFrame]
  let brand: String
  let title: String
}

/// Draws one overlay image for a given time. Kept free of UIKit view state so
/// it can run on the export queue.
final class OverlayPainter {
  private let spec: ClipSpec
  private let times: [Double]

  // Bones and joints match src/pose/landmarks.ts.
  private static let bones: [(Int, Int)] = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (24, 26), (26, 28), (27, 29), (29, 31), (27, 31), (28, 30), (30, 32), (28, 32),
  ]
  private static let joints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

  init(spec: ClipSpec) {
    self.spec = spec
    self.times = spec.frames.map { $0.t / 1000.0 }
  }

  /// Latest timeline frame at or before `seconds` (binary search).
  private func frame(at seconds: Double) -> ClipFrame? {
    guard !times.isEmpty else { return nil }
    var lo = 0, hi = times.count - 1, best = -1
    while lo <= hi {
      let mid = (lo + hi) / 2
      if times[mid] <= seconds { best = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return best >= 0 ? spec.frames[best] : spec.frames.first
  }

  func overlay(at seconds: Double, size: CGSize) -> CIImage? {
    guard size.width > 0, size.height > 0 else { return nil }
    let frame = self.frame(at: seconds)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      draw(frame: frame, in: ctx.cgContext, size: size)
    }
    guard let cg = image.cgImage else { return nil }
    return CIImage(cgImage: cg)
  }

  private func draw(frame: ClipFrame?, in g: CGContext, size: CGSize) {
    let w = size.width
    let h = size.height
    let unit = min(w, h) / 100.0

    if let f = frame, f.pts.count >= 33 * 3 {
      let point = { (i: Int) -> CGPoint? in
        let v = f.pts[i * 3 + 2]
        guard v >= 0.5 else { return nil }
        return CGPoint(x: f.pts[i * 3] * Double(w), y: f.pts[i * 3 + 1] * Double(h))
      }
      g.setLineCap(.round)
      g.setLineWidth(unit * 1.2)
      g.setStrokeColor(UIColor.white.withAlphaComponent(0.92).cgColor)
      for (a, b) in Self.bones {
        if let pa = point(a), let pb = point(b) {
          g.move(to: pa)
          g.addLine(to: pb)
        }
      }
      g.strokePath()
      let jointColor = f.goodFlash ? UIColor(red: 0.30, green: 0.85, blue: 0.45, alpha: 1) : UIColor.white
      g.setFillColor(jointColor.cgColor)
      for j in Self.joints {
        if let p = point(j) {
          let r = unit * 1.4
          g.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
        }
      }
    }

    guard let f = frame else { return }

    // Rep counter, top center: "7/15".
    let counter = "\(f.reps)/\(f.target)"
    drawText(counter, center: CGPoint(x: w / 2, y: h * 0.11), font: .systemFont(ofSize: unit * 16, weight: .heavy),
             color: .white, pill: UIColor.black.withAlphaComponent(0.35), padding: unit * 3, in: g)

    if f.goodFlash {
      drawText("✓", center: CGPoint(x: w / 2, y: h * 0.21), font: .systemFont(ofSize: unit * 10, weight: .bold),
               color: .white, pill: UIColor(red: 0.20, green: 0.75, blue: 0.40, alpha: 0.95), padding: unit * 2, in: g)
    }

    // Cue pill near the bottom.
    let cueColor: UIColor
    switch f.tone {
    case "good": cueColor = UIColor(red: 0.20, green: 0.75, blue: 0.40, alpha: 0.92)
    case "warn": cueColor = UIColor(red: 0.95, green: 0.55, blue: 0.10, alpha: 0.92)
    default: cueColor = UIColor.black.withAlphaComponent(0.55)
    }
    if !f.cue.isEmpty {
      drawText(f.cue, center: CGPoint(x: w / 2, y: h * 0.82), font: .systemFont(ofSize: unit * 5.5, weight: .bold),
               color: .white, pill: cueColor, padding: unit * 2.5, in: g)
    }

    // Branding, bottom right.
    let brand = "🦏 \(spec.brand)"
    let brandFont = UIFont.systemFont(ofSize: unit * 4.5, weight: .heavy)
    let brandSize = (brand as NSString).size(withAttributes: [.font: brandFont])
    drawText(brand, center: CGPoint(x: w - brandSize.width / 2 - unit * 5, y: h - unit * 7), font: brandFont,
             color: .white, pill: UIColor.black.withAlphaComponent(0.35), padding: unit * 1.8, in: g)
    // Title, top left.
    let titleFont = UIFont.systemFont(ofSize: unit * 4, weight: .semibold)
    let titleSize = (spec.title as NSString).size(withAttributes: [.font: titleFont])
    drawText(spec.title, center: CGPoint(x: titleSize.width / 2 + unit * 5, y: unit * 7), font: titleFont,
             color: .white, pill: nil, padding: 0, in: g)
  }

  private func drawText(
    _ text: String, center: CGPoint, font: UIFont, color: UIColor, pill: UIColor?, padding: CGFloat,
    in g: CGContext
  ) {
    let shadow = NSShadow()
    shadow.shadowColor = UIColor.black.withAlphaComponent(0.6)
    shadow.shadowBlurRadius = 4
    shadow.shadowOffset = .zero
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .shadow: shadow]
    let s = (text as NSString).size(withAttributes: attrs)
    let rect = CGRect(x: center.x - s.width / 2, y: center.y - s.height / 2, width: s.width, height: s.height)
    if let pill = pill {
      let bg = rect.insetBy(dx: -padding * 1.4, dy: -padding * 0.6)
      g.setFillColor(pill.cgColor)
      g.addPath(UIBezierPath(roundedRect: bg, cornerRadius: bg.height / 2).cgPath)
      g.fillPath()
    }
    (text as NSString).draw(in: rect, withAttributes: attrs)
  }
}
