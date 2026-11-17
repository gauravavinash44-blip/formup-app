module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Lets VisionCamera frame processors run as worklets on the camera thread.
    plugins: [['react-native-worklets-core/plugin']],
  };
};
