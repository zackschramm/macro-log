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

export interface RaceCardLeg {
  leg: 'swim' | 'bike' | 'run';
  hours: number;
  carbRateGPerH: number;
  fluidL: number;
  sodiumMg: number;
}

export interface RaceCardData {
  /** What the athlete called the race. Falls back to the distance label. */
  raceName: string;
  /** 'Sprint' | 'Olympic' | '70.3' | 'Ironman'. */
  distanceLabel: string;
  totalHours: number;
  totalCarbG: number;
  legs: RaceCardLeg[];
}

type ShareCardProps =
  | { type: 'weekly'; data: WeeklyCardData }
  | { type: 'inbody'; data: InBodyCardData }
  | { type: 'race'; data: RaceCardData };

export default function ShareCardGenerator(props: ShareCardProps) {
  if (props.type === 'weekly') {
    return <WeeklyCard data={props.data} />;
  }
  if (props.type === 'race') {
    return <RaceCard data={props.data} />;
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

const LEG_META: Record<RaceCardLeg['leg'], { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  swim: { label: 'SWIM', icon: 'water-outline' },
  bike: { label: 'BIKE', icon: 'bicycle-outline' },
  run:  { label: 'RUN',  icon: 'walk-outline' },
};

/** Hours as "4:35" — a race split, not a decimal. */
function hm(hours: number): string {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function RaceCard({ data }: { data: RaceCardData }) {
  return (
    <View style={s.card}>
      <Text style={s.brand}>FUELOG</Text>
      <Text style={s.raceName} numberOfLines={2}>{data.raceName.toUpperCase()}</Text>
      <Text style={s.weekLabel}>
        {data.distanceLabel} · {hm(data.totalHours)} · {data.totalCarbG}g carbs
      </Text>
      <View style={s.divider} />

      {data.legs.map(l => {
        const meta = LEG_META[l.leg];
        return (
          <View key={l.leg} style={s.legBlock}>
            <View style={s.legHead}>
              <Ionicons name={meta.icon} size={14} color="#C8FF3D" />
              <Text style={s.legName}>{meta.label}</Text>
              <View style={{ flex: 1 }} />
              <Text style={s.legHours}>{hm(l.hours)}</Text>
            </View>
            <View style={s.legStats}>
              <View style={s.legStat}>
                <Text style={s.legStatVal}>{l.carbRateGPerH}</Text>
                <Text style={s.legStatLabel}>g carb/h</Text>
              </View>
              <View style={s.legStat}>
                <Text style={s.legStatVal}>{l.fluidL.toFixed(1)}</Text>
                <Text style={s.legStatLabel}>L fluid</Text>
              </View>
              <View style={s.legStat}>
                <Text style={s.legStatVal}>{l.sodiumMg}</Text>
                <Text style={s.legStatLabel}>mg sodium</Text>
              </View>
            </View>
          </View>
        );
      })}

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
  raceName: {
    fontSize: 21,
    fontWeight: '800',
    color: '#F5F6F4',
    letterSpacing: -0.4,
    marginBottom: 2,
  },
  legBlock: {
    marginBottom: 14,
  },
  legHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  legName: {
    fontSize: 11,
    fontWeight: '800',
    color: '#C8FF3D',
    letterSpacing: 1.5,
  },
  legHours: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9A9A9A',
    letterSpacing: 0.5,
  },
  legStats: {
    flexDirection: 'row',
    backgroundColor: '#1E2022',
    borderRadius: 10,
    paddingVertical: 10,
  },
  legStat: {
    flex: 1,
    alignItems: 'center',
  },
  legStatVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F5F6F4',
    letterSpacing: -0.5,
  },
  legStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9A9A9A',
    marginTop: 1,
  },
  footer: {
    fontSize: 11,
    color: '#5A5A5A',
    fontWeight: '600',
    letterSpacing: 1,
    textAlign: 'right',
  },
});
