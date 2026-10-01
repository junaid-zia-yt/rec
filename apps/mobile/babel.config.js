// Standard Expo SDK 52 babel config. `react-native-reanimated/plugin` must
// stay last in the plugins array (required by @gorhom/bottom-sheet, which
// depends on Reanimated for its animated sheet transitions).
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  }
}
