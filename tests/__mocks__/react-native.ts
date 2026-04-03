// Minimal mock for react-native in Vitest environment

export const Platform = {
  OS: 'web' as const,
  select: (obj: Record<string, any>) => obj.web ?? obj.default,
};

export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T): T => styles,
};

export const View = 'View';
export const Text = 'Text';
export const ScrollView = 'ScrollView';
export const ActivityIndicator = 'ActivityIndicator';
export const Pressable = 'Pressable';
export const TouchableOpacity = 'TouchableOpacity';
export const TextInput = 'TextInput';
export const FlatList = 'FlatList';
export const Switch = 'Switch';
export const Alert = {
  alert: () => {},
};
