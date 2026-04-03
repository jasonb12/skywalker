import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

const MAPPING = {
  "house.fill": "home",
  "map.fill": "map",
  "magnifyingglass": "search",
  "clock.fill": "history",
  "gearshape.fill": "settings",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "location.fill": "my-location",
  "arrow.up": "arrow-upward",
  "arrow.turn.up.left": "turn-left",
  "arrow.turn.up.right": "turn-right",
  "arrow.up.left": "north-west",
  "arrow.up.right": "north-east",
  "arrow.uturn.down": "u-turn-left",
  "flag.fill": "flag",
  "xmark": "close",
  "line.3.horizontal": "menu",
  "plus": "add",
  "minus": "remove",
  "mappin.and.ellipse": "place",
  "building.2.fill": "business",
  "fork.knife": "restaurant",
  "cup.and.saucer.fill": "local-cafe",
  "bag.fill": "shopping-bag",
  "cross.fill": "local-pharmacy",
  "star.fill": "star",
  "info.circle.fill": "info",
  "checkmark.circle.fill": "check-circle",
  "exclamationmark.triangle.fill": "warning",
  "arrow.left": "arrow-back",
} as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
