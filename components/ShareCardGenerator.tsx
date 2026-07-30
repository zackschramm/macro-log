import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { useUnits } from '../constants/units';

interface WeeklyCardData {
  avgCalories: number | null;
  avgProtein: number | null;
  workoutCount: number | null;
  streak: number;
  weekLabel: string;
}

interface InBodyCardData {
  fatChangeLb: number;
  muscleChangeLb: number;
  weeksTracked: number;
}

type ShareCardProps =
  | { type: 'weekly'; data: WeeklyCardData }
  | { type: 'inbody'; data: InBodyCardData };

export default function ShareCardGenerator(props: ShareCardProps) {
  if (props.type === 'weekly') {
    return <WeeklyCard data={props.data} />;
  }
  return <InBodyCard data={props.data} />;
}

function WeeklyCard({ data }: { data: WeeklyCardData }) {
  const stats = [
    { val: data.avgCalories != null ? String(data.avgCalories) : '—', label: 'avg calories', emoji: '' },
    { val: data.avgProtein != null ? `${data.avgProtein}g` : '—', label: 'avg protein', emoji: '' },
    { val: data.workoutCount != null ? String(data.workoutCount) : '—', label: 'workouts logged', emoji: '' },
    { val: data.streak > 0 ? `${data.streak}-day` : '—', label: 'streak', emoji: '' },
  ];

  return (
    <View style={s.card}>
      <Text style={s.brand}>FUELOG</Text>
      <Text style={s.weekLabel}>{data.weekLabel}</Text>
      <View style={s.divider} />
      {stats.map(({ val, label, emoji }) => (
        <View key={label} style={s.statRow}>
          <Text style={s.statVal}>{val}</Text>
          <Text style={s.statLabel}>{label}</Text>
          <View style={{ flex: 1 }} />
          <Text style={s.statEmoji}>{emoji}</Text>
        </View>
      ))}
      <View style={s.divider} />
      <Text style={s.footer}>fuelog.app</Text>
    </View>
  );
}

function InBodyCard({ data }: { data: InBodyCardData }) {
  const u = useUnits();
  // data fields are in canonical lbs; convert to display unit for rendering.
  const fmtChange = (lb: number, positiveSign = true) => {
    const disp = u.dispWeight(Math.abs(lb), 1);
    const sign = lb > 0 ? (positiveSign ? '+' : '') : '-';
    return `${sign}${disp} ${u.weightUnit}`;
  };

  return (
    <View style={s.card}>
      <Text style={s.brand}>FUELOG</Text>
      <Text style={s.weekLabel}>BODY COMPOSITION UPDATE</Text>
      <View style={s.divider} />
      <View style={s.statRow}>
        <Text style={[s.statVal, { color: data.fatChangeLb <= 0 ? '#C8FF3D' : '#FF4444' }]}>
          {fmtChange(data.fatChangeLb)}
        </Text>
        <Text style={s.statLabel}>body fat</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name={data.fatChangeLb <= 0 ? "arrow-down" : "arrow-up"} size={16} color={data.fatChangeLb <= 0 ? "#C8FF3D" : "#FF4444"} />
      </View>
      <View style={s.statRow}>
        <Text style={[s.statVal, { color: data.muscleChangeLb >= 0 ? '#C8FF3D' : '#FF4444' }]}>
          {fmtChange(data.muscleChangeLb)}
        </Text>
        <Text style={s.statLabel}>muscle</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name={data.muscleChangeLb >= 0 ? "arrow-up" : "arrow-down"} size={16} color={data.muscleChangeLb >= 0 ? "#C8FF3D" : "#FF4444"} />
      </View>
      <View style={s.statRow}>
        <Text style={s.statVal}>{data.weeksTracked}</Text>
        <Text style={s.statLabel}>weeks of tracking</Text>
        <View style={{ flex: 1 }} />
        <Ionicons name="stats-chart" size={16} color="#C8FF3D" />
      </View>
      <View style={s.divider} />
      <Text style={s.footer}>fuelog.app</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    width: 320,
    backgroundColor: '#161819',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#232527',
  },
  brand: {
    fontSize: 13,
    fontWeight: '800',
    color: '#C8FF3D',
    letterSpacing: 3,
    marginBottom: 4,
  },
  weekLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9A9A9A',
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  divider: {
    height: 1,
    backgroundColor: '#232527',
    marginVertical: 12,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  statVal: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F5F5F5',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 13,
    color: '#9A9A9A',
    fontWeight: '500',
    alignSelf: 'flex-end',
    marginBottom: 2,
  },
  statEmoji: {
    fontSize: 18,
  },
  footer: {
    fontSize: 11,
    color: '#5A5A5A',
    fontWeight: '600',
    letterSpacing: 1,
    textAlign: 'right',
  },
});
