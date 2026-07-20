import React, { useEffect, useRef } from 'react';
import { View, Animated, ViewStyle, DimensionValue } from 'react-native';
import { useTheme } from '../constants/theme';

interface Props {
  width: DimensionValue;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export default function SkeletonBox({ width, height, borderRadius = 8, style }: Props) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[{ width, height }, style]}>
      <Animated.View style={{ flex: 1, borderRadius, backgroundColor: colors.cardAlt, opacity }} />
    </View>
  );
}
