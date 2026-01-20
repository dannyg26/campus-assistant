import {
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  RefreshControl,
  Modal,
  Alert,
  Dimensions,
  PanResponder,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { apiService } from '@/services/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Line, Circle } from 'react-native-svg';

const { width } = Dimensions.get('window');
const CARD_IMAGE_HEIGHT = 180;
const MAX_NAME_LEN = 20;
const MAX_QUALITIES = 6;
const CHART_W = Math.min(300, Math.max(220, Math.floor(width - 140)));
const CHART_H = 80;
const PAD_L = 18;
const PAD_T = 14;
const PAD_B = 18;
const PAD_R = 8;
const INSET = 14;
const DOT_R = 10;
const DOT_GLOW_R = 18;
const LINE_COLOR = '#2E7BA6';
const LINE_STROKE = 4;
const AREA_FILL = '#2E7BA638';
const DOT_FILL = '#2E7BA6';
const DOT_GLOW_FILL = '#2E7BA638';
const SVG_W = PAD_L + CHART_W + PAD_R;
const SVG_H = PAD_T + CHART_H + PAD_B;

type TabType = 'foryou' | 'events' | 'announcements';

interface Location {
  id: string;
  name: string;
  address: string;
  pictures?: Array<{ url: string; caption?: string }>;
  rating?: number;
  reviews_count?: number;
  level_of_business?: 'high' | 'moderate' | 'low';
  most_known_for?: string;
  description?: string;
  created_at?: string;
}

interface Review {
  id: string;
  user_name: string;
  user_role?: string;
  user_profile_pic?: string;
  rating: number;
  review_text?: string;
  created_at: string;
}

interface EventItem {
  id: string;
  event_name: string;
  location?: string;
  top_qualities?: string;
  description?: string;
  picture?: string;
  meeting_time?: string;
  created_at?: string;
}

const countQualities = (text?: string) => {
  if (!text) return 0;
  return text
    .split(/[,;\n]/)
    .map((q) => q.trim())
    .filter(Boolean).length;
};

function ActivityLevelGraph({
  ratings,
}: {
  ratings: Array<{ level: string; created_at: string }>;
}) {
  const points = useMemo(() => {
    const now = Date.now();
    type L = 0 | 1 | 2;
    const toL = (s: string): L => (s === 'high' ? 2 : s === 'moderate' ? 1 : 0);
    const byHour = new Map<number, { level: L; created_at: string }[]>();
    for (const r of ratings) {
      const hoursAgo = (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
      if (hoursAgo >= 24) continue;
      const x = 23 - Math.min(23, Math.floor(hoursAgo));
      if (!byHour.has(x)) byHour.set(x, []);
      byHour.get(x)!.push({ level: toL(r.level), created_at: r.created_at });
    }
    const out: { x: number; y: L }[] = [];
    for (const [x, arr] of byHour.entries()) {
      const low = arr.filter((a) => a.level === 0).length;
      const mod = arr.filter((a) => a.level === 1).length;
      const high = arr.filter((a) => a.level === 2).length;
      const maxC = Math.max(low, mod, high);
      const single =
        [low === maxC && maxC > 0, mod === maxC && maxC > 0, high === maxC && maxC > 0].filter(Boolean)
          .length === 1;
      const y: L = single
        ? low === maxC
          ? 0
          : mod === maxC
            ? 1
            : 2
        : [...arr].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0]!.level;
      out.push({ x, y });
    }
    return out.sort((a, b) => a.x - b.x);
  }, [ratings]);

  const toSvg = (p: { x: number; y: 0 | 1 | 2 }) => {
    const xSvg = PAD_L + (p.x / 23) * CHART_W;
    const top = PAD_T + INSET;
    const bottom = PAD_T + CHART_H - INSET;
    const ySvg = p.y === 2 ? top : p.y === 1 ? (top + bottom) / 2 : bottom;
    return { x: xSvg, y: ySvg };
  };

  const smoothPath = useMemo(() => {
    if (points.length < 2) return '';
    const pts = points.map(toSvg);
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const tension = 0.5;
      const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
      const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
      const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
      const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }, [points]);

  const areaPath = useMemo(() => {
    if (points.length < 2) return '';
    const pts = points.map(toSvg);
    const last = pts[pts.length - 1];
    const first = pts[0];
    const baseY = PAD_T + CHART_H;
    return `${smoothPath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;
  }, [points, smoothPath]);

  const hasData = points.length > 0;
  const top = PAD_T + INSET;
  const bottom = PAD_T + CHART_H - INSET;
  const gridY = [top, (top + bottom) / 2, bottom];

  return (
    <View style={activityGraphStyles.card}>
      <View style={activityGraphStyles.headerRow}>
        <ThemedText style={activityGraphStyles.title}>Activity Level</ThemedText>
        <ThemedText style={activityGraphStyles.subtitle}>Last 24 hours</ThemedText>
      </View>

      <View style={activityGraphStyles.chartRow}>
        <View style={activityGraphStyles.yAxis}>
          <ThemedText style={activityGraphStyles.yLabel} numberOfLines={1}>High</ThemedText>
          <ThemedText style={activityGraphStyles.yLabel} numberOfLines={1}>Moderate</ThemedText>
          <ThemedText style={activityGraphStyles.yLabel} numberOfLines={1}>Low</ThemedText>
        </View>

        <View style={activityGraphStyles.svgWrap}>
          <Svg width="100%" height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
            {gridY.map((y, idx) => (
              <Line
                key={idx}
                x1={PAD_L}
                y1={y}
                x2={PAD_L + CHART_W}
                y2={y}
                stroke="#D0DCE8"
                strokeWidth={1.5}
              />
            ))}

            <Line
              x1={PAD_L + (CHART_W * 12) / 23}
              y1={PAD_T}
              x2={PAD_L + (CHART_W * 12) / 23}
              y2={PAD_T + CHART_H}
              stroke="#D8E2EE"
              strokeWidth={1.5}
            />

            {areaPath ? <Path d={areaPath} fill={AREA_FILL} /> : null}

            {smoothPath ? (
              <Path
                d={smoothPath}
                fill="none"
                stroke={LINE_COLOR}
                strokeWidth={LINE_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {hasData &&
              points.map((p, i) => {
                const { x, y } = toSvg(p);
                return (
                  <React.Fragment key={i}>
                    <Circle cx={x} cy={y} r={DOT_GLOW_R} fill={DOT_GLOW_FILL} />
                    <Circle cx={x} cy={y} r={DOT_R} fill={DOT_FILL} stroke={LINE_COLOR} strokeWidth={2} />
                  </React.Fragment>
                );
              })}

            {!hasData ? (
              <Path
                d={`M ${PAD_L} ${PAD_T + CHART_H} L ${PAD_L + CHART_W} ${PAD_T + CHART_H}`}
                stroke="#B0BEC8"
                strokeWidth={2.5}
                strokeDasharray="8 6"
              />
            ) : null}
          </Svg>
        </View>
      </View>

      <View style={activityGraphStyles.xAxis}>
        <ThemedText style={activityGraphStyles.xLabel}>24h ago</ThemedText>
        <ThemedText style={activityGraphStyles.xLabel}>12h</ThemedText>
        <ThemedText style={activityGraphStyles.xLabel}>Now</ThemedText>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [orgName, setOrgName] = useState<string>('');
  const [orgProfilePic, setOrgProfilePic] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('foryou');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Announcements tab
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [announcementDetail, setAnnouncementDetail] = useState<any | null>(null);
  const [announcementComments, setAnnouncementComments] = useState<any[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Request announcement (students request; admin reviews in Manage)
  const [showRequestAnnouncementModal, setShowRequestAnnouncementModal] = useState(false);
  const [requestAnnouncementTitle, setRequestAnnouncementTitle] = useState('');
  const [requestAnnouncementBody, setRequestAnnouncementBody] = useState('');
  const [requestAnnouncementImage, setRequestAnnouncementImage] = useState<string | null>(null);
  const [requestAnnouncementSubmitting, setRequestAnnouncementSubmitting] = useState(false);

  // Events tab
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showRequestEventModal, setShowRequestEventModal] = useState(false);
  const [requestEventName, setRequestEventName] = useState('');
  const [requestEventLocation, setRequestEventLocation] = useState('');
  const [requestEventTopQualities, setRequestEventTopQualities] = useState('');
  const [requestEventDescription, setRequestEventDescription] = useState('');
  const [requestEventMeetingTime, setRequestEventMeetingTime] = useState('');
  const [requestEventImage, setRequestEventImage] = useState<string | null>(null);
  const [requestEventSubmitting, setRequestEventSubmitting] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [showEventDetailModal, setShowEventDetailModal] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Location | null>(null);
  const [showPlaceDetailModal, setShowPlaceDetailModal] = useState(false);
  const [placeReviews, setPlaceReviews] = useState<Review[]>([]);
  const [placeReviewsLoading, setPlaceReviewsLoading] = useState(false);
  const [showPlaceReviewModal, setShowPlaceReviewModal] = useState(false);
  const [placeReviewRating, setPlaceReviewRating] = useState(0);
  const [placeReviewText, setPlaceReviewText] = useState('');
  const [placeActivityRatings, setPlaceActivityRatings] = useState<{
    ratings: Array<{ level: string; created_at: string }>;
    can_rate: boolean;
    cooldown_until: string | null;
  } | null>(null);
  const [placeActivityLoading, setPlaceActivityLoading] = useState(false);
  const [placeActivitySubmitting, setPlaceActivitySubmitting] = useState(false);

  const placeDetailSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowPlaceDetailModal(false);
        },
      }),
    []
  );

  const announcementDetailSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setAnnouncementDetail(null);
        },
      }),
    []
  );

  const requestAnnouncementSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowRequestAnnouncementModal(false);
        },
      }),
    []
  );

  const requestEventSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowRequestEventModal(false);
        },
      }),
    []
  );

  const eventDetailSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowEventDetailModal(false);
        },
      }),
    []
  );

  const placeReviewSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowPlaceReviewModal(false);
        },
      }),
    []
  );

  // For You feed: recent places, announcements, high-activity places (last 2 days)
  type ForYouItem =
    | { type: 'place'; data: Location; sortDate: string }
    | { type: 'announcement'; data: any; sortDate: string }
    | { type: 'event'; data: EventItem; sortDate: string };
  const [forYouFeed, setForYouFeed] = useState<ForYouItem[]>([]);
  const [forYouLoading, setForYouLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, authLoading]);

  const fetchOrg = useCallback(() => {
    if (!isAuthenticated) return;
    apiService
      .getMyOrg()
      .then((d: { name?: string; org_profile_pic?: string | null }) => {
        setOrgName(d.name || '');
        setOrgProfilePic(d.org_profile_pic || null);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  useFocusEffect(
    useCallback(() => {
      fetchOrg();
    }, [fetchOrg])
  );

  // Perform search when debounced term changes
  useEffect(() => {
    if (!debouncedSearchTerm && !hasSearched) {
      return;
    }

    const performSearch = async () => {
      if (debouncedSearchTerm.trim().length === 0) {
        setLocations([]);
        setHasSearched(false);
        return;
      }

      setSearchLoading(true);
      setHasSearched(true);
      try {
        const data = await apiService.getLocations({
          search: debouncedSearchTerm.trim(),
        });
        setLocations(Array.isArray(data) ? data : []);
      } catch (error) {
        setLocations([]);
      } finally {
        setSearchLoading(false);
      }
    };

    performSearch();
  }, [debouncedSearchTerm]);

  // Load announcements when Announcements tab is selected
  useEffect(() => {
    if (activeTab === 'announcements') {
      const load = async () => {
        setAnnouncementsLoading(true);
        try {
          const data = await apiService.getAnnouncements();
          setAnnouncements(Array.isArray(data) ? data : []);
        } catch (e) {
          setAnnouncements([]);
        } finally {
          setAnnouncementsLoading(false);
        }
      };
      load();
    }
  }, [activeTab]);

  // Load events when Events tab is selected
  useEffect(() => {
    if (activeTab === 'events') {
      const load = async () => {
        setEventsLoading(true);
        try {
          const data = await apiService.getEvents();
          setEvents(Array.isArray(data) ? data : []);
        } catch (e) {
          setEvents([]);
        } finally {
          setEventsLoading(false);
        }
      };
      load();
    }
  }, [activeTab]);

  const loadAnnouncementComments = async (id: string) => {
    setCommentsLoading(true);
    try {
      const data = await apiService.getAnnouncementComments(id);
      setAnnouncementComments(Array.isArray(data) ? data : []);
    } catch (e) {
      setAnnouncementComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const openAnnouncementDetail = async (a: any) => {
    setAnnouncementDetail(a);
    setNewCommentBody('');
    await loadAnnouncementComments(a.id);
  };

  const pickRequestAnnouncementImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setRequestAnnouncementImage(result.assets[0].uri);
    }
  };

  const pickRequestEventImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setRequestEventImage(result.assets[0].uri);
    }
  };

  const openEventDetail = (evt: EventItem) => {
    setSelectedEvent(evt);
    setShowEventDetailModal(true);
  };

  const openPlaceDetail = (place: Location) => {
    setSelectedPlace(place);
    setShowPlaceDetailModal(true);
    loadPlaceReviews(place.id);
    loadPlaceActivityRatings(place.id);
  };

  const loadPlaceReviews = async (locationId: string) => {
    setPlaceReviewsLoading(true);
    try {
      const data = await apiService.getReviews(locationId);
      setPlaceReviews(Array.isArray(data) ? data : []);
    } catch (error) {
      setPlaceReviews([]);
    } finally {
      setPlaceReviewsLoading(false);
    }
  };

  const loadPlaceActivityRatings = async (locationId: string) => {
    setPlaceActivityLoading(true);
    try {
      const data = await apiService.getLocationActivityRatings(locationId);
      setPlaceActivityRatings(data);
    } catch (error) {
      setPlaceActivityRatings(null);
    } finally {
      setPlaceActivityLoading(false);
    }
  };

  const submitPlaceReview = async () => {
    if (!selectedPlace) return;
    if (placeReviewRating === 0) {
      Alert.alert('Error', 'Please select a rating');
      return;
    }
    try {
      await apiService.createReview(selectedPlace.id, placeReviewRating, placeReviewText);
      setShowPlaceReviewModal(false);
      setPlaceReviewText('');
      setPlaceReviewRating(0);
      await loadPlaceReviews(selectedPlace.id);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to submit review');
    }
  };

  const submitPlaceActivityRating = async (level: 'low' | 'moderate' | 'high') => {
    if (!selectedPlace) return;
    setPlaceActivitySubmitting(true);
    try {
      await apiService.submitLocationActivityRating(selectedPlace.id, level);
      await loadPlaceActivityRatings(selectedPlace.id);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to submit rating');
    } finally {
      setPlaceActivitySubmitting(false);
    }
  };

  const pickImageForOrg = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      let data = result.assets[0].uri;
      if (data.startsWith('file://')) {
        try {
          const response = await fetch(data);
          const blob = await response.blob();
          const reader = new FileReader();
          data = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          Alert.alert('Error', 'Failed to process image');
          return;
        }
      }
      try {
        await apiService.updateOrgProfilePic(data);
        setOrgProfilePic(data);
      } catch (e: any) {
        Alert.alert('Error', e?.response?.data?.detail || 'Failed to update org picture');
      }
    }
  };

  const loadForYou = useCallback(async () => {
    if (!isAuthenticated) return;
    setForYouLoading(true);
    try {
      const [recentRes, activityRes, annRes, eventsRes] = await Promise.all([
        apiService.getLocations({ created_since_hours: 48, sort: 'recent' }),
        apiService.getLocations({ sort: 'activity', activity_since_hours: 48 }),
        apiService.getAnnouncements(),
        apiService.getEvents(),
      ]);
      const recent = Array.isArray(recentRes) ? recentRes : [];
      const activity = Array.isArray(activityRes) ? activityRes : [];
      const placeById = new Map<string, Location>();
      for (const p of recent) placeById.set(p.id, p as Location);
      for (const p of activity) if (!placeById.has(p.id)) placeById.set(p.id, p as Location);
      const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
      const ann = (Array.isArray(annRes) ? annRes : []).filter(
        (a: any) => a.published_at && new Date(a.published_at).getTime() >= twoDaysAgo
      );
      const ev = (Array.isArray(eventsRes) ? eventsRes : []).filter(
        (e: any) => e.created_at && new Date(e.created_at).getTime() >= twoDaysAgo
      );
      const items: ForYouItem[] = [];
      for (const p of placeById.values()) {
        const d = p.created_at || '';
        if (d) items.push({ type: 'place', data: p, sortDate: d });
      }
      for (const a of ann) items.push({ type: 'announcement', data: a, sortDate: a.published_at || a.created_at || '' });
      for (const e of ev) items.push({ type: 'event', data: e, sortDate: e.created_at || '' });
      items.sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());
      setForYouFeed(items);
    } catch (e) {
      setForYouFeed([]);
    } finally {
      setForYouLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (activeTab === 'foryou' && isAuthenticated) loadForYou();
  }, [activeTab, isAuthenticated, loadForYou]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'foryou') {
        await loadForYou();
      } else if (activeTab === 'events') {
        const data = await apiService.getEvents();
        setEvents(Array.isArray(data) ? data : []);
      } else if (activeTab === 'announcements') {
        const data = await apiService.getAnnouncements();
        setAnnouncements(Array.isArray(data) ? data : []);
        if (announcementDetail) {
          const comments = await apiService.getAnnouncementComments(announcementDetail.id);
          setAnnouncementComments(Array.isArray(comments) ? comments : []);
        }
      } else if (hasSearched && debouncedSearchTerm.trim()) {
        const data = await apiService.getLocations({
          search: debouncedSearchTerm.trim(),
        });
        setLocations(Array.isArray(data) ? data : []);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchTerm(text);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (text.trim().length === 0) {
      setDebouncedSearchTerm('');
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchTerm(text);
    }, 500);
  };

  const parseQualities = (text?: string): string[] => {
    if (!text) return [];
    return text
      .split(/[,;\n]/)
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 3);
  };

  const getBusinessLevelColor = (level?: string) => {
    switch (level) {
      case 'high':
        return '#FF6B6B';
      case 'moderate':
        return '#FFA726';
      case 'low':
        return '#66BB6A';
      default:
        return '#8B7355';
    }
  };

  if (authLoading) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.loadingText}>Loading...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <ThemedView style={styles.container}>
        <View
          style={[
            styles.header,
            {
              flexDirection: 'row',
              alignItems: 'center',
              paddingTop: insets.top + 18, // replaces the fixed 90 so it looks correct on all iPhones
            },
          ]}>
          <ThemedText type="title" style={[styles.title, { flex: 1 }]}>
            {orgName || 'Your Organization'}
          </ThemedText>

          <TouchableOpacity
            onPress={user?.role === 'admin' ? pickImageForOrg : undefined}
            style={styles.orgHeaderAvatarWrap}
            activeOpacity={user?.role === 'admin' ? 0.7 : 1}
            disabled={user?.role !== 'admin'}>
            {orgProfilePic ? (
              <Image source={{ uri: orgProfilePic }} style={styles.orgHeaderAvatar} resizeMode="cover" />
            ) : (
              <View style={[styles.orgHeaderAvatar, styles.orgHeaderAvatarEmpty]} />
            )}
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchWrapper}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search places by name or address..."
              placeholderTextColor="#888888"
              value={searchTerm}
              onChangeText={handleSearchChange}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => {
                if (debounceTimerRef.current) {
                  clearTimeout(debounceTimerRef.current);
                }
                setDebouncedSearchTerm(searchTerm);
                Keyboard.dismiss();
              }}
              blurOnSubmit={true}
            />
          </View>
        </View>

        {/* Search Results */}
        {hasSearched ? (
          searchLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#5FA8D3" />
              <ThemedText style={styles.loadingText}>Searching...</ThemedText>
            </View>
          ) : (
            <FlatList
              data={locations}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => {
                const qualities = parseQualities(item.most_known_for);
                const primaryImage = item.pictures?.[0]?.url;

                return (
                  <TouchableOpacity style={styles.locationCard} activeOpacity={0.9}>
                    {primaryImage ? (
                      <Image source={{ uri: primaryImage }} style={styles.cardImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                        <ThemedText style={styles.placeholderText}>No Image</ThemedText>
                      </View>
                    )}

                    <View style={styles.cardContent}>
                      <View style={styles.cardHeader}>
                        <View style={styles.nameRatingContainer}>
                          <ThemedText style={styles.locationName}>{item.name}</ThemedText>
                          <View style={styles.ratingContainer}>
                            <ThemedText style={styles.ratingIcon}>★</ThemedText>
                            <ThemedText style={styles.ratingText}>{item.rating?.toFixed(1) || '0.0'}</ThemedText>
                            {item.reviews_count !== undefined && item.reviews_count > 0 && (
                              <ThemedText style={styles.reviewCount}>({item.reviews_count})</ThemedText>
                            )}
                          </View>
                        </View>
                      </View>

                      {item.level_of_business ? (
                        <View style={styles.cardBusinessBlock}>
                          <ThemedText style={styles.cardBusinessLabel}>Level of business: </ThemedText>
                          <View
                            style={[
                              styles.businessBadge,
                              { backgroundColor: getBusinessLevelColor(item.level_of_business) },
                            ]}>
                            <ThemedText style={styles.businessBadgeText}>{item.level_of_business}</ThemedText>
                          </View>
                        </View>
                      ) : null}

                      <ThemedText style={styles.address}>{item.address}</ThemedText>

                      {qualities.length > 0 && (
                        <View style={styles.qualitiesContainer}>
                          {qualities.map((quality, index) => (
                            <View key={index} style={styles.qualityBox}>
                              <ThemedText style={styles.qualityText}>{quality}</ThemedText>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>No places found matching "{searchTerm}"</ThemedText>
                </View>
              }
            />
          )
        ) : (
          <View style={styles.nonSearchContainer}>
            {/* Centered Tab Bar (pill) */}
            <View style={styles.tabBarWrap}>
              <View style={styles.tabBar}>
                <TouchableOpacity
                  style={[styles.tab, activeTab === 'foryou' && styles.tabActive]}
                  onPress={() => setActiveTab('foryou')}>
                  <ThemedText
                    style={[styles.tabText, activeTab === 'foryou' && styles.tabTextActive]}
                    numberOfLines={1}>
                    For You
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tab, activeTab === 'events' && styles.tabActive]}
                  onPress={() => setActiveTab('events')}>
                  <ThemedText
                    style={[styles.tabText, activeTab === 'events' && styles.tabTextActive]}
                    numberOfLines={1}>
                    Events
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tab, activeTab === 'announcements' && styles.tabActive]}
                  onPress={() => setActiveTab('announcements')}>
                  <ThemedText
                    style={[styles.tabText, activeTab === 'announcements' && styles.tabTextActive]}
                    numberOfLines={1}>
                    Announcements
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>

            {/* Tab Content */}
            <View style={styles.content}>
              {activeTab === 'foryou' ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.forYouList}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                  showsVerticalScrollIndicator={false}>
                  {forYouLoading ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="large" color="#5FA8D3" />
                      <ThemedText style={styles.loadingText}>Loading...</ThemedText>
                    </View>
                  ) : forYouFeed.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <ThemedText style={styles.emptyText}>No recent activity in the last 2 days</ThemedText>
                      <ThemedText style={styles.subtitle}>New places, announcements, and popular spots will show here</ThemedText>
                    </View>
                  ) : (
                    forYouFeed.map((it) =>
                      it.type === 'place' ? (
                        <TouchableOpacity
                          key={`p-${it.data.id}`}
                          style={styles.locationCard}
                          onPress={() => openPlaceDetail(it.data)}
                          activeOpacity={0.9}>
                          {it.data.pictures?.[0]?.url ? (
                            <Image source={{ uri: it.data.pictures[0].url }} style={styles.cardImage} resizeMode="cover" />
                          ) : (
                            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                              <ThemedText style={styles.placeholderText}>No Image</ThemedText>
                            </View>
                          )}
                          <View style={styles.cardContent}>
                            <View style={styles.cardHeader}>
                              <View style={styles.nameRatingContainer}>
                                <ThemedText style={styles.locationName}>{it.data.name}</ThemedText>
                                <View style={styles.ratingContainer}>
                                  <ThemedText style={styles.ratingIcon}>★</ThemedText>
                                  <ThemedText style={styles.ratingText}>{it.data.rating?.toFixed(1) || '0.0'}</ThemedText>
                                </View>
                              </View>
                            </View>
                            {it.data.level_of_business ? (
                              <View style={styles.cardBusinessBlock}>
                                <ThemedText style={styles.cardBusinessLabel}>Level of business: </ThemedText>
                                <View style={[styles.businessBadge, { backgroundColor: getBusinessLevelColor(it.data.level_of_business) }]}>
                                  <ThemedText style={styles.businessBadgeText}>{it.data.level_of_business}</ThemedText>
                                </View>
                              </View>
                            ) : null}
                            <ThemedText style={styles.address}>{it.data.address}</ThemedText>
                            {parseQualities(it.data.most_known_for).length > 0 && (
                              <View style={styles.qualitiesContainer}>
                                {parseQualities(it.data.most_known_for).map((q, i) => (
                                  <View key={i} style={styles.qualityBox}><ThemedText style={styles.qualityText}>{q}</ThemedText></View>
                                ))}
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      ) : it.type === 'announcement' ? (
                        <TouchableOpacity
                          key={`a-${it.data.id}`}
                          style={styles.announcementCard}
                          onPress={() => openAnnouncementDetail(it.data)}
                          activeOpacity={0.9}>
                          {it.data.image ? (
                            <Image source={{ uri: it.data.image }} style={styles.announcementListImage} resizeMode="cover" />
                          ) : null}
                          <ThemedText style={styles.announcementCardTitle}>{it.data.title}</ThemedText>
                          <ThemedText style={styles.announcementCardBody} numberOfLines={2}>{it.data.body}</ThemedText>
                          <ThemedText style={styles.announcementCardDate}>
                            {it.data.published_at ? new Date(it.data.published_at).toLocaleDateString() : new Date(it.data.created_at).toLocaleDateString()}
                          </ThemedText>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          key={`e-${it.data.id}`}
                          style={styles.eventCard}
                          onPress={() => openEventDetail(it.data)}
                          activeOpacity={0.9}>
                          {it.data.picture ? (
                            <Image source={{ uri: it.data.picture }} style={styles.eventCardImage} resizeMode="cover" />
                          ) : null}
                          <ThemedText style={styles.eventCardTitle}>{it.data.event_name}</ThemedText>
                          {it.data.meeting_time ? (
                            <ThemedText style={styles.eventCardMeta}>Meeting time: {it.data.meeting_time}</ThemedText>
                          ) : null}
                          {it.data.location ? (
                            <ThemedText style={styles.eventCardMeta}>Location: {it.data.location}</ThemedText>
                          ) : null}
                          {it.data.description ? (
                            <ThemedText style={styles.eventCardBody} numberOfLines={2}>{it.data.description}</ThemedText>
                          ) : null}
                          {parseQualities(it.data.top_qualities).length > 0 && (
                            <View style={styles.qualitiesContainer}>
                              {parseQualities(it.data.top_qualities).map((q, i) => (
                                <View key={i} style={styles.qualityBox}>
                                  <ThemedText style={styles.qualityText}>{q}</ThemedText>
                                </View>
                              ))}
                            </View>
                          )}
                        </TouchableOpacity>
                      )
                    )
                  )}
                </ScrollView>
              ) : activeTab === 'events' ? (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
                  {user?.role !== 'admin' && (
                    <TouchableOpacity
                      style={styles.requestAnnouncementButton}
                      onPress={() => {
                        setRequestEventName('');
                        setRequestEventLocation('');
                        setRequestEventTopQualities('');
                        setRequestEventDescription('');
                        setRequestEventMeetingTime('');
                        setRequestEventImage(null);
                        setShowRequestEventModal(true);
                      }}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.requestAnnouncementButtonText}>Request Event</ThemedText>
                    </TouchableOpacity>
                  )}

                  {eventsLoading ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="large" color="#5FA8D3" />
                      <ThemedText style={styles.loadingText}>Loading events...</ThemedText>
                    </View>
                  ) : (
                    <>
                      {events.map((e) => (
                        <TouchableOpacity
                          key={e.id}
                          style={styles.eventCard}
                          onPress={() => openEventDetail(e)}
                          activeOpacity={0.9}>
                          {e.picture ? (
                            <Image source={{ uri: e.picture }} style={styles.eventCardImage} resizeMode="cover" />
                          ) : null}
                          <ThemedText style={styles.eventCardTitle}>{e.event_name}</ThemedText>
                          {e.meeting_time ? (
                            <ThemedText style={styles.eventCardMeta}>Meeting time: {e.meeting_time}</ThemedText>
                          ) : null}
                          {e.location ? (
                            <ThemedText style={styles.eventCardMeta}>Location: {e.location}</ThemedText>
                          ) : null}
                          {e.description ? (
                            <ThemedText style={styles.eventCardBody}>{e.description}</ThemedText>
                          ) : null}
                          {parseQualities(e.top_qualities).length > 0 && (
                            <View style={styles.qualitiesContainer}>
                              {parseQualities(e.top_qualities).map((q, i) => (
                                <View key={i} style={styles.qualityBox}>
                                  <ThemedText style={styles.qualityText}>{q}</ThemedText>
                                </View>
                              ))}
                            </View>
                          )}
                        </TouchableOpacity>
                      ))}

                      {events.length === 0 && !eventsLoading && (
                        <View style={styles.emptyContainer}>
                          <ThemedText style={styles.emptyText}>No events yet</ThemedText>
                        </View>
                      )}
                    </>
                  )}
                </ScrollView>
              ) : (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
                  {user?.role !== 'admin' && (
                  <TouchableOpacity
                    style={styles.requestAnnouncementButton}
                    onPress={() => {
                      setRequestAnnouncementTitle('');
                      setRequestAnnouncementBody('');
                      setRequestAnnouncementImage(null);
                      setShowRequestAnnouncementModal(true);
                    }}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.requestAnnouncementButtonText}>Request Announcement</ThemedText>
                  </TouchableOpacity>
                  )}

                  {announcementsLoading ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="large" color="#5FA8D3" />
                      <ThemedText style={styles.loadingText}>Loading announcements...</ThemedText>
                    </View>
                  ) : (
                    <>
                      {announcements.map((a) => (
                        <TouchableOpacity
                          key={a.id}
                          style={styles.announcementCard}
                          onPress={() => openAnnouncementDetail(a)}
                          activeOpacity={0.9}>
                          {a.image ? (
                            <Image
                              source={{ uri: a.image }}
                              style={styles.announcementListImage}
                              resizeMode="cover"
                            />
                          ) : null}
                          <ThemedText style={styles.announcementCardTitle}>{a.title}</ThemedText>
                          <ThemedText style={styles.announcementCardBody} numberOfLines={2}>
                            {a.body}
                          </ThemedText>
                          <ThemedText style={styles.announcementCardDate}>
                            {a.published_at
                              ? new Date(a.published_at).toLocaleDateString()
                              : new Date(a.created_at).toLocaleDateString()}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}

                      {announcements.length === 0 && !announcementsLoading && (
                        <View style={styles.emptyContainer}>
                          <ThemedText style={styles.emptyText}>No announcements</ThemedText>
                        </View>
                      )}
                    </>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        )}

        {/* Announcement Detail Modal */}
        <Modal
          visible={!!announcementDetail}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setAnnouncementDetail(null)}>
          {announcementDetail && (
            <View style={styles.modalContainer} {...announcementDetailSwipeResponder.panHandlers}>
              <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
                <TouchableOpacity onPress={() => setAnnouncementDetail(null)}>
                  <ThemedText style={styles.modalBackButton}>← Back</ThemedText>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
                keyboardShouldPersistTaps="handled">
                <ThemedText style={styles.announcementDetailTitle}>{announcementDetail.title}</ThemedText>
                <ThemedText style={styles.announcementDetailDate}>
                  Published{' '}
                  {announcementDetail.published_at
                    ? new Date(announcementDetail.published_at).toLocaleDateString()
                    : new Date(announcementDetail.created_at).toLocaleDateString()}
                </ThemedText>

                {announcementDetail.image ? (
                  <Image
                    source={{ uri: announcementDetail.image }}
                    style={styles.announcementDetailImage}
                    resizeMode="cover"
                  />
                ) : null}

                <ThemedText style={styles.announcementDetailBody}>{announcementDetail.body}</ThemedText>

                <ThemedText style={styles.commentsSectionTitle}>Comments</ThemedText>

                {commentsLoading ? (
                  <ActivityIndicator size="small" color="#5FA8D3" style={{ marginVertical: 16 }} />
                ) : (
                  announcementComments.map((c) => (
                    <View key={c.id} style={styles.commentRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={styles.commentAuthor}>{c.user_name || 'Unknown'}</ThemedText>
                        <ThemedText style={styles.commentBody}>{c.body}</ThemedText>
                      </View>

                      {(user?.role === 'admin' || (c.user_id && (user as any)?.id === c.user_id)) && (
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert('Delete Comment', 'Are you sure?', [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await apiService.deleteAnnouncementComment(announcementDetail.id, c.id);
                                    await loadAnnouncementComments(announcementDetail.id);
                                  } catch (e) {
                                    Alert.alert('Error', 'Failed to delete comment');
                                  }
                                },
                              },
                            ]);
                          }}>
                          <ThemedText style={{ color: '#FF6B6B', fontSize: 12 }}>Delete</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}

                <View style={styles.commentInputRow}>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="Add a comment..."
                    placeholderTextColor="#888888"
                    value={newCommentBody}
                    onChangeText={setNewCommentBody}
                    multiline
                  />
                  <TouchableOpacity
                    style={[styles.commentSubmitBtn, (!newCommentBody.trim() || commentsLoading) && { opacity: 0.5 }]}
                    disabled={!newCommentBody.trim() || commentsLoading}
                    onPress={async () => {
                      if (!newCommentBody.trim()) return;
                      try {
                        await apiService.createAnnouncementComment(announcementDetail.id, newCommentBody.trim());
                        setNewCommentBody('');
                        await loadAnnouncementComments(announcementDetail.id);
                      } catch (e) {
                        Alert.alert('Error', 'Failed to post comment');
                      }
                    }}>
                    <ThemedText style={styles.commentSubmitText}>Post</ThemedText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          )}
        </Modal>

        {/* Request Announcement Modal */}
        <Modal
          visible={showRequestAnnouncementModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowRequestAnnouncementModal(false)}>
          <View style={styles.modalContainer} {...requestAnnouncementSwipeResponder.panHandlers}>
            <View
              style={[
                styles.modalHeader,
                { paddingTop: insets.top + 16, flexDirection: 'row', alignItems: 'center' },
              ]}>
              <TouchableOpacity onPress={() => setShowRequestAnnouncementModal(false)}>
                <ThemedText style={styles.modalBackButton}>← Cancel</ThemedText>
              </TouchableOpacity>
              <ThemedText style={[styles.modalHeaderTitle, { flex: 1, textAlign: 'center' }]}>
                Request Announcement
              </ThemedText>
              <View style={{ width: 80 }} />
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
              <ThemedText style={styles.requestFormLabel}>Title *</ThemedText>
              <TextInput
                style={styles.requestFormInput}
                placeholder="Title"
                placeholderTextColor="#888888"
                value={requestAnnouncementTitle}
                onChangeText={setRequestAnnouncementTitle}
                maxLength={MAX_NAME_LEN}
              />

              <ThemedText style={styles.requestFormLabel}>Body *</ThemedText>
              <TextInput
                style={[styles.requestFormInput, { minHeight: 120, textAlignVertical: 'top' }]}
                placeholder="What would you like to announce?"
                placeholderTextColor="#888888"
                value={requestAnnouncementBody}
                onChangeText={setRequestAnnouncementBody}
                multiline
              />

              <ThemedText style={styles.requestFormLabel}>Image (optional)</ThemedText>
              {requestAnnouncementImage ? (
                <View style={{ marginBottom: 12 }}>
                  <Image
                    source={{ uri: requestAnnouncementImage }}
                    style={{ width: '100%', height: 180, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                  <TouchableOpacity onPress={() => setRequestAnnouncementImage(null)} style={{ marginTop: 8 }}>
                    <ThemedText style={{ color: '#FF6B6B', fontSize: 14 }}>Remove image</ThemedText>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.requestFormImageButton}
                  onPress={pickRequestAnnouncementImage}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.requestFormImageButtonText}>Choose Image</ThemedText>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.requestFormSubmitButton,
                  (requestAnnouncementSubmitting ||
                    !requestAnnouncementTitle.trim() ||
                    !requestAnnouncementBody.trim()) && { opacity: 0.6 },
                ]}
                disabled={
                  requestAnnouncementSubmitting ||
                  !requestAnnouncementTitle.trim() ||
                  !requestAnnouncementBody.trim()
                }
                onPress={async () => {
                  setRequestAnnouncementSubmitting(true);
                  try {
                    let img: string | undefined;
                    if (requestAnnouncementImage) {
                      if (requestAnnouncementImage.startsWith('file://')) {
                        const resp = await fetch(requestAnnouncementImage);
                        const bl = await resp.blob();
                        img = await new Promise<string>((res, rej) => {
                          const r = new FileReader();
                          r.onloadend = () => res(r.result as string);
                          r.onerror = rej;
                          r.readAsDataURL(bl);
                        });
                      } else {
                        img = requestAnnouncementImage;
                      }
                    }
                    await apiService.createAnnouncementRequest({
                      title: requestAnnouncementTitle.trim(),
                      body: requestAnnouncementBody.trim(),
                      image: img,
                    });
                    Alert.alert('Submitted', 'Your request was sent. An admin will review it.');
                    setShowRequestAnnouncementModal(false);
                    setRequestAnnouncementTitle('');
                    setRequestAnnouncementBody('');
                    setRequestAnnouncementImage(null);
                  } catch (e: any) {
                    Alert.alert('Error', e?.response?.data?.detail || 'Failed to submit request');
                  } finally {
                    setRequestAnnouncementSubmitting(false);
                  }
                }}
                activeOpacity={0.7}>
                <ThemedText style={styles.requestFormSubmitButtonText}>
                  {requestAnnouncementSubmitting ? 'Submitting...' : 'Submit Request'}
                </ThemedText>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>

        {/* Request Event Modal */}
        <Modal
          visible={showRequestEventModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowRequestEventModal(false)}>
          <View style={styles.modalContainer} {...requestEventSwipeResponder.panHandlers}>
            <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
              <TouchableOpacity onPress={() => setShowRequestEventModal(false)}>
                <ThemedText style={styles.modalBackButton}>← Back</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.modalTitle}>Request Event</ThemedText>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled">
              <View style={styles.requestFormGroup}>
                <ThemedText style={styles.requestFormLabel}>Event name *</ThemedText>
                <TextInput
                  style={styles.requestFormInput}
                  placeholder="Event name"
                  placeholderTextColor="#888888"
                  value={requestEventName}
                  onChangeText={setRequestEventName}
                  maxLength={MAX_NAME_LEN}
                />
              </View>

              <View style={styles.requestFormGroup}>
                <ThemedText style={styles.requestFormLabel}>Location</ThemedText>
                <TextInput
                  style={styles.requestFormInput}
                  placeholder="Where is it?"
                  placeholderTextColor="#888888"
                  value={requestEventLocation}
                  onChangeText={setRequestEventLocation}
                />
              </View>

              <View style={styles.requestFormGroup}>
                <ThemedText style={styles.requestFormLabel}>Meeting time</ThemedText>
                <TextInput
                  style={styles.requestFormInput}
                  placeholder="e.g. Fri 6pm, Room 101"
                  placeholderTextColor="#888888"
                  value={requestEventMeetingTime}
                  onChangeText={setRequestEventMeetingTime}
                />
              </View>

              <View style={styles.requestFormGroup}>
                <ThemedText style={styles.requestFormLabel}>Description</ThemedText>
                <TextInput
                  style={[styles.requestFormInput, styles.requestFormTextArea]}
                  placeholder="Describe the event"
                  placeholderTextColor="#888888"
                  value={requestEventDescription}
                  onChangeText={setRequestEventDescription}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <View style={styles.requestFormGroup}>
                <ThemedText style={styles.requestFormLabel}>Top qualities</ThemedText>
                <TextInput
                  style={[styles.requestFormInput, styles.requestFormTextArea]}
                  placeholder="e.g. Food, Networking, Live music"
                  placeholderTextColor="#888888"
                  value={requestEventTopQualities}
                  onChangeText={setRequestEventTopQualities}
                  multiline
                  numberOfLines={3}
                />
                <ThemedText style={styles.requestFormHint}>
                  Use commas to create bubbles (e.g., Food, Networking, Live music).
                </ThemedText>
              </View>

              <View style={styles.requestFormGroup}>
                <ThemedText style={styles.requestFormLabel}>Image (optional)</ThemedText>
                <TouchableOpacity
                  style={styles.requestFormImageButton}
                  onPress={pickRequestEventImage}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.requestFormImageButtonText}>Choose Image</ThemedText>
                </TouchableOpacity>
                {requestEventImage ? (
                  <Image source={{ uri: requestEventImage }} style={styles.requestFormImagePreview} />
                ) : null}
              </View>

              <TouchableOpacity
                style={[
                  styles.requestFormSubmitButton,
                  (requestEventSubmitting || !requestEventName.trim()) && { opacity: 0.6 },
                ]}
                disabled={requestEventSubmitting || !requestEventName.trim()}
                onPress={async () => {
                  if (countQualities(requestEventTopQualities) > MAX_QUALITIES) {
                    Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
                    return;
                  }
                  setRequestEventSubmitting(true);
                  try {
                    let img: string | undefined;
                    if (requestEventImage) {
                      if (requestEventImage.startsWith('file://')) {
                        const resp = await fetch(requestEventImage);
                        const bl = await resp.blob();
                        img = await new Promise<string>((res, rej) => {
                          const r = new FileReader();
                          r.onloadend = () => res(r.result as string);
                          r.onerror = rej;
                          r.readAsDataURL(bl);
                        });
                      } else {
                        img = requestEventImage;
                      }
                    }
                    await apiService.createEventRequest({
                      event_name: requestEventName.trim(),
                      location: requestEventLocation.trim() || undefined,
                      meeting_time: requestEventMeetingTime.trim() || undefined,
                      description: requestEventDescription.trim() || undefined,
                      top_qualities: requestEventTopQualities.trim() || undefined,
                      picture: img,
                    });
                    Alert.alert('Submitted', 'Your event request was sent. An admin will review it.');
                    setShowRequestEventModal(false);
                    setRequestEventName('');
                    setRequestEventLocation('');
                    setRequestEventMeetingTime('');
                    setRequestEventDescription('');
                    setRequestEventTopQualities('');
                    setRequestEventImage(null);
                  } catch (e: any) {
                    Alert.alert('Error', e?.response?.data?.detail || 'Failed to submit request');
                  } finally {
                    setRequestEventSubmitting(false);
                  }
                }}
                activeOpacity={0.7}>
                <ThemedText style={styles.requestFormSubmitButtonText}>
                  {requestEventSubmitting ? 'Submitting...' : 'Submit Request'}
                </ThemedText>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>

        {/* Event Detail Modal */}
        <Modal
          visible={showEventDetailModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowEventDetailModal(false)}>
          {selectedEvent && (
            <View style={styles.modalContainer} {...eventDetailSwipeResponder.panHandlers}>
              <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
                <TouchableOpacity onPress={() => setShowEventDetailModal(false)}>
                  <ThemedText style={styles.modalBackButton}>← Back</ThemedText>
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                <ThemedText style={styles.eventDetailTitle}>{selectedEvent.event_name}</ThemedText>

                {selectedEvent.picture ? (
                  <Image
                    source={{ uri: selectedEvent.picture }}
                    style={styles.eventDetailImage}
                    resizeMode="cover"
                  />
                ) : null}

                {selectedEvent.meeting_time ? (
                  <ThemedText style={styles.eventDetailMeta}>Meeting time: {selectedEvent.meeting_time}</ThemedText>
                ) : null}
                {selectedEvent.location ? (
                  <ThemedText style={styles.eventDetailMeta}>Location: {selectedEvent.location}</ThemedText>
                ) : null}

                {selectedEvent.description ? (
                  <ThemedText style={styles.eventDetailBody}>{selectedEvent.description}</ThemedText>
                ) : null}

                {parseQualities(selectedEvent.top_qualities).length > 0 && (
                  <View style={[styles.qualitiesContainer, { marginTop: 8 }]}>
                    {parseQualities(selectedEvent.top_qualities).map((q, i) => (
                      <View key={i} style={styles.qualityBox}>
                        <ThemedText style={styles.qualityText}>{q}</ThemedText>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </Modal>

        {/* Place Detail Modal */}
        <Modal
          visible={showPlaceDetailModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowPlaceDetailModal(false)}>
          {selectedPlace && (
            <View style={styles.modalContainer} {...placeDetailSwipeResponder.panHandlers}>
              <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
                <TouchableOpacity onPress={() => setShowPlaceDetailModal(false)}>
                  <ThemedText style={styles.modalBackButton}>← Back</ThemedText>
                </TouchableOpacity>
                <View style={{ width: 40 }} />
              </View>

              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                <ThemedText style={styles.eventDetailTitle}>{selectedPlace.name}</ThemedText>

                {selectedPlace.pictures?.[0]?.url ? (
                  <Image
                    source={{ uri: selectedPlace.pictures[0].url }}
                    style={styles.eventDetailImage}
                    resizeMode="cover"
                  />
                ) : null}

                {selectedPlace.address ? (
                  <ThemedText style={styles.eventDetailMeta}>Address: {selectedPlace.address}</ThemedText>
                ) : null}
                {selectedPlace.level_of_business ? (
                  <ThemedText style={styles.eventDetailMeta}>
                    Level of business: {selectedPlace.level_of_business}
                  </ThemedText>
                ) : null}

                {selectedPlace.description ? (
                  <ThemedText style={styles.eventDetailBody}>{selectedPlace.description}</ThemedText>
                ) : null}

                {parseQualities(selectedPlace.most_known_for).length > 0 && (
                  <View style={[styles.qualitiesContainer, { marginTop: 8 }]}>
                    {parseQualities(selectedPlace.most_known_for).map((q, i) => (
                      <View key={i} style={styles.qualityBox}>
                        <ThemedText style={styles.qualityText}>{q}</ThemedText>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.placeDetailActions}>
                  <TouchableOpacity
                    style={styles.placeDetailActionButton}
                    onPress={() => setShowPlaceReviewModal(true)}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.placeDetailActionText}>✍️ Leave Review</ThemedText>
                  </TouchableOpacity>
                  {selectedPlace.address ? (
                    <TouchableOpacity
                      style={styles.placeDetailActionButton}
                      onPress={() => {
                        const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                          selectedPlace.address
                        )}&travelmode=driving`;
                        Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open maps'));
                      }}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.placeDetailActionText}>Get Directions</ThemedText>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.placeReviewsSection}>
                  <ThemedText style={styles.placeReviewsTitle}>
                    Reviews ({selectedPlace.reviews_count || 0})
                  </ThemedText>
                  {placeReviewsLoading ? (
                    <ActivityIndicator size="small" color="#5FA8D3" style={{ marginTop: 8 }} />
                  ) : placeReviews.length === 0 ? (
                    <View style={styles.placeNoReviews}>
                      <ThemedText style={styles.placeNoReviewsText}>No reviews yet</ThemedText>
                      <ThemedText style={styles.placeNoReviewsSubtext}>
                        Be the first to review this location!
                      </ThemedText>
                    </View>
                  ) : (
                    placeReviews.map((review) => (
                      <View key={review.id} style={styles.placeReviewCard}>
                        <View style={styles.placeReviewHeader}>
                          <View style={styles.placeReviewAuthorRow}>
                            <View style={styles.placeReviewAvatar}>
                              <ThemedText style={styles.placeReviewAvatarText}>
                                {review.user_name?.charAt(0).toUpperCase() || 'U'}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.placeReviewAuthor}>
                              {review.user_name}
                              {review.user_role ? ` • ${review.user_role}` : ''}
                            </ThemedText>
                          </View>
                          <View style={styles.placeReviewRatingRow}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <ThemedText
                                key={star}
                                style={[
                                  styles.placeReviewStar,
                                  star <= review.rating && styles.placeReviewStarActive,
                                ]}>
                                ★
                              </ThemedText>
                            ))}
                          </View>
                        </View>
                        {review.review_text ? (
                          <ThemedText style={styles.placeReviewText}>{review.review_text}</ThemedText>
                        ) : null}
                        <ThemedText style={styles.placeReviewDate}>
                          {new Date(review.created_at).toLocaleDateString()}
                        </ThemedText>
                      </View>
                    ))
                  )}
                </View>

                <View style={styles.placeActivitySection}>
                  <ThemedText style={styles.placeActivityTitle}>Activity level (last 24 hours)</ThemedText>
                  <ActivityLevelGraph ratings={placeActivityRatings?.ratings ?? []} />

                  <ThemedText style={styles.placeActivityRateLabel}>Rate level of activity</ThemedText>
                  {placeActivityLoading ? (
                    <ActivityIndicator size="small" color="#5FA8D3" style={{ marginTop: 6 }} />
                  ) : !placeActivityRatings?.can_rate && placeActivityRatings?.cooldown_until ? (
                    <ThemedText style={styles.placeActivityCooldown}>
                      You can rate again in {(() => {
                        const totalMins = Math.max(
                          0,
                          Math.ceil(
                            (new Date(placeActivityRatings!.cooldown_until!).getTime() - Date.now()) / 60000
                          )
                        );
                        const hrs = Math.floor(totalMins / 60);
                        const mins = totalMins % 60;
                        const hrText = hrs > 0 ? `${hrs} hour${hrs !== 1 ? 's' : ''}` : '';
                        const minText = `${mins} minute${mins !== 1 ? 's' : ''}`;
                        return hrText ? `${hrText} and ${minText}` : minText;
                      })()}
                    </ThemedText>
                  ) : (
                    <View style={styles.placeActivityButtonRow}>
                      {(['low', 'moderate', 'high'] as const).map((lvl) => (
                        <TouchableOpacity
                          key={lvl}
                          style={[
                            styles.placeActivityButton,
                            placeActivitySubmitting && { opacity: 0.6 },
                          ]}
                          onPress={() => submitPlaceActivityRating(lvl)}
                          activeOpacity={0.7}
                          disabled={placeActivitySubmitting}>
                          <ThemedText style={styles.placeActivityButtonText}>
                            {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          )}
        </Modal>

        {/* Place Review Modal */}
        <Modal
          visible={showPlaceReviewModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowPlaceReviewModal(false)}>
          <View style={styles.placeReviewModalOverlay}>
            <View style={styles.placeReviewModalContent} {...placeReviewSwipeResponder.panHandlers}>
              <View style={styles.placeReviewModalHeader}>
                <ThemedText style={styles.placeReviewModalTitle}>Leave a Review</ThemedText>
                <TouchableOpacity onPress={() => setShowPlaceReviewModal(false)}>
                  <ThemedText style={styles.placeReviewModalClose}>✕</ThemedText>
                </TouchableOpacity>
              </View>

              <View style={styles.placeReviewStars}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} onPress={() => setPlaceReviewRating(star)}>
                    <ThemedText
                      style={[
                        styles.placeReviewStarLarge,
                        placeReviewRating >= star && styles.placeReviewStarLargeActive,
                      ]}>
                      ★
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.placeReviewInput}
                placeholder="Share your experience..."
                placeholderTextColor="#888888"
                value={placeReviewText}
                onChangeText={setPlaceReviewText}
                multiline
                numberOfLines={5}
              />

              <TouchableOpacity
                style={[
                  styles.placeReviewSubmitButton,
                  placeReviewRating === 0 && { opacity: 0.6 },
                ]}
                onPress={submitPlaceReview}
                disabled={placeReviewRating === 0}
                activeOpacity={0.7}>
                <ThemedText style={styles.placeReviewSubmitText}>Submit Review</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ThemedView>
    </TouchableWithoutFeedback>
  );
}

const TAB_BAR_WIDTH = Math.min(520, Math.floor(width * 0.96));

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
  },
  header: {
    paddingTop: 20, // actual top padding is applied via insets in render
    paddingBottom: 20,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    textAlign: 'left',
    lineHeight: 28,
  },

  // Bigger avatar + pulled slightly left from the edge
  orgHeaderAvatarWrap: { padding: 4, marginRight: 10 },
  orgHeaderAvatar: { width: 52, height: 52, borderRadius: 26, overflow: 'hidden' },
  orgHeaderAvatarEmpty: { backgroundColor: '#E8D5C4', borderWidth: 1, borderColor: '#C4A77D' },

  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  searchWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  searchInput: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#2C3E50',
  },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color: '#8B7355',
    marginTop: 12,
  },

  forYouList: {
    padding: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  list: {
    padding: 16,
    paddingTop: 12,
  },
  locationCard: {
    marginBottom: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    overflow: 'hidden',
    shadowColor: '#5FA8D3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  cardImage: {
    width: '100%',
    height: CARD_IMAGE_HEIGHT,
    backgroundColor: '#F0F0F0',
  },
  cardImagePlaceholder: {
    backgroundColor: '#E8D5C4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#8B7355',
    fontSize: 16,
  },
  cardContent: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  nameRatingContainer: {
    flex: 1,
    marginRight: 12,
  },
  locationName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingIcon: {
    fontSize: 18,
    color: '#FFB800',
  },
  ratingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
  },
  reviewCount: {
    fontSize: 14,
    color: '#8B7355',
  },
  cardBusinessBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardBusinessLabel: {
    fontSize: 12,
    color: '#8B7355',
    marginRight: 6,
  },
  businessBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  businessBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  address: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 12,
  },
  qualitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  qualityBox: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#E8F4F8',
    borderWidth: 1,
    borderColor: '#5FA8D3',
  },
  qualityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5FA8D3',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#8B7355',
    textAlign: 'center',
  },

  nonSearchContainer: {
    flex: 1,
  },

  // Tabs centered in the middle horizontally (pill / segmented control)
  tabBarWrap: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: '#F8F8F8',
  },
  tabBar: {
    flexDirection: 'row',
    width: TAB_BAR_WIDTH,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8D5C4',
    borderRadius: 14,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#5FA8D3',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B7355',
    textAlign: 'center',
  },
  tabTextActive: {
    color: '#5FA8D3',
  },

  content: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    opacity: 0.7,
    color: '#8B7355',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 24,
  },

  announcementCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  announcementCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 8,
  },
  announcementCardBody: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 8,
    lineHeight: 20,
  },
  announcementCardDate: {
    fontSize: 12,
    color: '#5FA8D3',
  },
  announcementListImage: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#F0F0F0',
  },
  eventCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  eventCardImage: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#F0F0F0',
  },
  eventCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 6,
  },
  eventCardMeta: {
    fontSize: 13,
    color: '#5FA8D3',
    marginBottom: 4,
  },
  eventCardBody: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 6,
    lineHeight: 20,
  },
  eventDetailTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 12,
  },
  eventDetailImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#F0F0F0',
  },
  eventDetailMeta: {
    fontSize: 13,
    color: '#5FA8D3',
    marginBottom: 6,
  },
  eventDetailBody: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 8,
  },
  announcementDetailImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#F0F0F0',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F8F8F8',
  },
  modalHeader: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  modalBackButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#5FA8D3',
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
  },

  requestAnnouncementButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  requestAnnouncementButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  requestFormLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 8,
    marginTop: 4,
  },
  requestFormHint: {
    fontSize: 12,
    color: '#8B7355',
    marginTop: 6,
  },
  requestFormGroup: {
    marginBottom: 12,
  },
  requestFormInput: {
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#2C3E50',
    marginBottom: 4,
  },
  requestFormTextArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  requestFormImageButton: {
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  requestFormImageButtonText: {
    color: '#5FA8D3',
    fontSize: 15,
    fontWeight: '600',
  },
  requestFormImagePreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 12,
  },
  requestFormSubmitButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  requestFormSubmitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  announcementDetailTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 8,
  },
  announcementDetailDate: {
    fontSize: 13,
    color: '#8B7355',
    marginBottom: 16,
  },
  announcementDetailBody: {
    fontSize: 16,
    color: '#2C3E50',
    lineHeight: 24,
    marginBottom: 24,
  },

  commentsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 12,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  commentAuthor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 4,
  },
  commentBody: {
    fontSize: 14,
    color: '#8B7355',
    lineHeight: 20,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  commentInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#2C3E50',
    maxHeight: 100,
  },
  commentSubmitBtn: {
    backgroundColor: '#5FA8D3',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  commentSubmitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  placeDetailActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 8,
  },
  placeDetailActionButton: {
    flex: 1,
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  placeDetailActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  placeReviewsSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8D5C4',
  },
  placeReviewsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 10,
  },
  placeNoReviews: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  placeNoReviewsText: {
    fontSize: 15,
    color: '#8B7355',
    marginBottom: 4,
  },
  placeNoReviewsSubtext: {
    fontSize: 13,
    color: '#8B7355',
  },
  placeReviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E8D5C4',
    marginBottom: 10,
  },
  placeReviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  placeReviewAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  placeReviewAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E8D5C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeReviewAvatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2C3E50',
  },
  placeReviewAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2C3E50',
  },
  placeReviewRatingRow: {
    flexDirection: 'row',
    gap: 2,
  },
  placeReviewStar: {
    fontSize: 12,
    color: '#E0E0E0',
  },
  placeReviewStarActive: {
    color: '#F5B642',
  },
  placeReviewText: {
    fontSize: 14,
    color: '#2C3E50',
    marginBottom: 6,
  },
  placeReviewDate: {
    fontSize: 12,
    color: '#8B7355',
  },
  placeActivitySection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8D5C4',
  },
  placeActivityTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 8,
  },
  placeActivityRateLabel: {
    fontSize: 14,
    color: '#5FA8D3',
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  placeActivityCooldown: {
    fontSize: 13,
    color: '#8B7355',
    marginTop: 6,
  },
  placeActivityButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  placeActivityButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#5FA8D3',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  placeActivityButtonText: {
    color: '#5FA8D3',
    fontWeight: '700',
    fontSize: 13,
  },
  placeReviewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  placeReviewModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
  },
  placeReviewModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  placeReviewModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
  },
  placeReviewModalClose: {
    fontSize: 18,
    color: '#8B7355',
  },
  placeReviewStars: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  placeReviewStarLarge: {
    fontSize: 22,
    color: '#E0E0E0',
  },
  placeReviewStarLargeActive: {
    color: '#F5B642',
  },
  placeReviewInput: {
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#2C3E50',
    marginBottom: 12,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  placeReviewSubmitButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  placeReviewSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

const activityGraphStyles = StyleSheet.create({
  card: {
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2C3E50',
  },
  subtitle: {
    fontSize: 12,
    color: '#8B7355',
    fontWeight: '600',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  yAxis: {
    width: 62,
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingRight: 8,
  },
  yLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
    textAlign: 'left',
  },
  svgWrap: { flex: 1, overflow: 'hidden' },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 13,
    paddingLeft: 62,
    paddingRight: 8,
  },
  xLabel: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '700',
  },
});
