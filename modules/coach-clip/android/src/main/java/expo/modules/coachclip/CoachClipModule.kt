package expo.modules.coachclip

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.google.common.collect.ImmutableList
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

/**
 * Renders a "coach clip": the recorded workout video with the skeleton, rep
 * counter, form cue and FormUp branding burned into every frame.
 */
@OptIn(markerClass = [UnstableApi::class])
class CoachClipModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CoachClip")

    AsyncFunction("renderAsync") { inputUri: String, specJson: String, outputUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_COACH_CLIP_CONTEXT", "App context is not available", null)
        return@AsyncFunction
      }
      val spec = try {
        ClipSpec.parse(specJson)
      } catch (e: Exception) {
        promise.reject("ERR_COACH_CLIP_SPEC", "Could not read the overlay timeline: ${e.message}", e)
        return@AsyncFunction
      }
      val outputPath = Uri.parse(outputUri).path ?: outputUri.removePrefix("file://")
      File(outputPath).delete()

      // Transformer must be created and started on a thread with a Looper.
      Handler(Looper.getMainLooper()).post {
        try {
          val overlay = OverlayEffect(ImmutableList.of(CoachOverlay(spec)))
          val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(inputUri)))
            .setEffects(Effects(ImmutableList.of(), ImmutableList.of<Effect>(overlay)))
            .build()
          val transformer = Transformer.Builder(context)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                promise.resolve("file://$outputPath")
              }

              override fun onError(
                composition: Composition,
                exportResult: ExportResult,
                exportException: ExportException,
              ) {
                promise.reject("ERR_COACH_CLIP_RENDER", exportException.message ?: "Video export failed", exportException)
              }
            })
            .build()
          transformer.start(item, outputPath)
        } catch (e: Exception) {
          promise.reject("ERR_COACH_CLIP_RENDER", e.message ?: "Video export failed", e)
        }
      }
    }
  }
}

data class ClipFrame(
  val t: Double,
  val pts: DoubleArray,
  val reps: Int,
  val target: Int,
  val cue: String,
  val tone: String,
  val goodFlash: Boolean,
)

class ClipSpec(val frames: List<ClipFrame>, val brand: String, val title: String) {
  companion object {
    fun parse(json: String): ClipSpec {
      val root = JSONObject(json)
      val arr = root.getJSONArray("frames")
      val frames = ArrayList<ClipFrame>(arr.length())
      for (i in 0 until arr.length()) {
        val f = arr.getJSONObject(i)
        val p = f.getJSONArray("pts")
        frames.add(
          ClipFrame(
            t = f.getDouble("t"),
            pts = DoubleArray(p.length()) { p.getDouble(it) },
            reps = f.getInt("reps"),
            target = f.getInt("target"),
            cue = f.optString("cue", ""),
            tone = f.optString("tone", "info"),
            goodFlash = f.optBoolean("goodFlash", false),
          ),
        )
      }
      return ClipSpec(frames, root.optString("brand", "FormUp"), root.optString("title", ""))
    }
  }
}

/** Draws the overlay for each output frame. Bones and joints match src/pose/landmarks.ts. */
@OptIn(markerClass = [UnstableApi::class])
class CoachOverlay(private val spec: ClipSpec) : CanvasOverlay(/* useInputFrameSize= */ true) {
  private val times = DoubleArray(spec.frames.size) { spec.frames[it].t / 1000.0 }

  private val bonePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.argb(235, 255, 255, 255)
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
  }
  private val jointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
    setShadowLayer(4f, 0f, 0f, Color.argb(150, 0, 0, 0))
  }
  private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

  private fun frameAt(seconds: Double): ClipFrame? {
    if (times.isEmpty()) return null
    var lo = 0
    var hi = times.size - 1
    var best = -1
    while (lo <= hi) {
      val mid = (lo + hi) / 2
      if (times[mid] <= seconds) { best = mid; lo = mid + 1 } else hi = mid - 1
    }
    return if (best >= 0) spec.frames[best] else spec.frames.first()
  }

  override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
    canvas.drawColor(Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)
    val w = canvas.width.toFloat()
    val h = canvas.height.toFloat()
    val unit = minOf(w, h) / 100f
    val f = frameAt(presentationTimeUs / 1_000_000.0) ?: return

    if (f.pts.size >= 33 * 3) {
      fun pt(i: Int): Pair<Float, Float>? {
        if (f.pts[i * 3 + 2] < 0.5) return null
        return Pair((f.pts[i * 3] * w).toFloat(), (f.pts[i * 3 + 1] * h).toFloat())
      }
      bonePaint.strokeWidth = unit * 1.2f
      for ((a, b) in BONES) {
        val pa = pt(a) ?: continue
        val pb = pt(b) ?: continue
        canvas.drawLine(pa.first, pa.second, pb.first, pb.second, bonePaint)
      }
      jointPaint.color = if (f.goodFlash) Color.rgb(77, 217, 115) else Color.WHITE
      for (j in JOINTS) {
        val p = pt(j) ?: continue
        canvas.drawCircle(p.first, p.second, unit * 1.4f, jointPaint)
      }
    }

    drawPill(canvas, "${f.reps}/${f.target}", w / 2, h * 0.11f, unit * 16f, Color.argb(90, 0, 0, 0), unit * 3f)
    if (f.goodFlash) {
      drawPill(canvas, "✓", w / 2, h * 0.21f, unit * 10f, Color.argb(242, 51, 191, 102), unit * 2f)
    }
    val cueColor = when (f.tone) {
      "good" -> Color.argb(235, 51, 191, 102)
      "warn" -> Color.argb(235, 242, 140, 26)
      else -> Color.argb(140, 0, 0, 0)
    }
    if (f.cue.isNotEmpty()) drawPill(canvas, f.cue, w / 2, h * 0.82f, unit * 5.5f, cueColor, unit * 2.5f)

    val brand = "🦏 ${spec.brand}"
    textPaint.textSize = unit * 4.5f
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    val brandW = textPaint.measureText(brand)
    drawPill(canvas, brand, w - brandW / 2 - unit * 5f, h - unit * 7f, unit * 4.5f, Color.argb(90, 0, 0, 0), unit * 1.8f)

    textPaint.textSize = unit * 4f
    val titleW = textPaint.measureText(spec.title)
    drawPill(canvas, spec.title, titleW / 2 + unit * 5f, unit * 7f, unit * 4f, Color.TRANSPARENT, 0f)
  }

  private fun drawPill(canvas: Canvas, text: String, cx: Float, cy: Float, size: Float, bg: Int, pad: Float) {
    textPaint.textSize = size
    textPaint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    val tw = textPaint.measureText(text)
    val fm = textPaint.fontMetrics
    val th = fm.descent - fm.ascent
    if (Color.alpha(bg) > 0) {
      pillPaint.color = bg
      val rect = RectF(cx - tw / 2 - pad * 1.4f, cy - th / 2 - pad * 0.6f, cx + tw / 2 + pad * 1.4f, cy + th / 2 + pad * 0.6f)
      canvas.drawRoundRect(rect, rect.height() / 2, rect.height() / 2, pillPaint)
    }
    canvas.drawText(text, cx, cy - (fm.ascent + fm.descent) / 2, textPaint)
  }

  companion object {
    val BONES = listOf(
      11 to 12, 11 to 13, 13 to 15, 12 to 14, 14 to 16, 11 to 23, 12 to 24, 23 to 24,
      23 to 25, 25 to 27, 24 to 26, 26 to 28, 27 to 29, 29 to 31, 27 to 31, 28 to 30, 30 to 32, 28 to 32,
    )
    val JOINTS = listOf(0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
  }
}
