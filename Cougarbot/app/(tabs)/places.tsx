import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Dimensions,
  Image,
  TouchableOpacity,
  Modal,
  Alert,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
  Linking,
  PanResponder,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Line, Circle } from 'react-native-svg';

const { width } = Dimensions.get('window');
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
const CARD_IMAGE_HEIGHT = 240;
const MAX_NAME_LEN = 20;
const MAX_QUALITIES = 6;

interface LocationPicture {
  url: string;
  caption?: string;
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

interface Location {
  id: string;
  name: string;
  address: string;
  pictures?: LocationPicture[];
  rating?: number;
  reviews_count?: number;
  description?: string;
  level_of_business?: 'high' | 'moderate' | 'low';
  most_known_for?: string;
}

type PlacesView = 'all' | 'favorites';





function ActivityLevelGraph({
  ratings,
}: {
  ratings: Array<{ level: string; created_at: string }>;
  getColor?: (l: string) => string;
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
      const single = [low === maxC && maxC > 0, mod === maxC && maxC > 0, high === maxC && maxC > 0].filter(Boolean).length === 1;
      const y: L = single ? (low === maxC ? 0 : mod === maxC ? 1 : 2) : [...arr].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]!.level;
      out.push({ x, y });
    }

    // De-dup same x (keep latest) so the line doesn’t jitter if multiple samples land on same hour.
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

      // Catmull-Rom -> Bezier smoothing
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

    // Close to x-axis baseline for a filled area
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
            {/* Grid lines (subtle) */}
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

            {/* Vertical grid at 12h mark */}
            <Line
              x1={PAD_L + (CHART_W * 12) / 23}
              y1={PAD_T}
              x2={PAD_L + (CHART_W * 12) / 23}
              y2={PAD_T + CHART_H}
              stroke="#D8E2EE"
              strokeWidth={1.5}
            />

            {/* Area fill */}
            {areaPath ? <Path d={areaPath} fill={AREA_FILL} /> : null}

            {/* Smoothed line */}
            {smoothPath ? (
              <Path
                d={smoothPath}
                fill="none"
                stroke="#5FA8D3"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {/* Data point markers (all points, so high/moderate/low are clearly visible) */}
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

            {/* “No data” state */}
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

  activityGraphSection: {
    paddingHorizontal: 18, // was 20
    paddingVertical: 14,
  },
  



});


export default function PlacesScreen() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [favorites, setFavorites] = useState<Location[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [placesView, setPlacesView] = useState<PlacesView>('all');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const router = useRouter();
  const { openLocationId } = useLocalSearchParams<{ openLocationId?: string }>();
  const openedLocationRef = useRef<string | null>(null);
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activityRatings, setActivityRatings] = useState<{
    ratings: Array<{ level: string; created_at: string }>;
    can_rate: boolean;
    cooldown_until: string | null;
  } | null>(null);
  const [activityRatingsLoading, setActivityRatingsLoading] = useState(false);
  const [activityRateSubmitting, setActivityRateSubmitting] = useState(false);

  // Student request location (Places tab)
  const [showRequestLocationModal, setShowRequestLocationModal] = useState(false);
  const [requestLocationName, setRequestLocationName] = useState('');
  const [requestLocationAddress, setRequestLocationAddress] = useState('');
  const [requestLocationDescription, setRequestLocationDescription] = useState('');
  const [requestLocationTopQualities, setRequestLocationTopQualities] = useState('');
  const [requestLocationLevel, setRequestLocationLevel] = useState<'high' | 'moderate' | 'low' | ''>('');
  const [requestLocationImage, setRequestLocationImage] = useState<string | null>(null);
  const [requestLocationSubmitting, setRequestLocationSubmitting] = useState(false);

  const requestLocationSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowRequestLocationModal(false);
        },
      }),
    []
  );

  const detailSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowDetailModal(false);
        },
      }),
    []
  );

  const reviewSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowReviewModal(false);
        },
      }),
    []
  );

  const reviewsSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 100) setShowReviewsModal(false);
        },
      }),
    []
  );

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated) {
        router.replace('/(auth)/login');
        return;
      }
      loadLocations();
      loadFavorites();
    }
  }, [isAuthenticated, authLoading]);

  useFocusEffect(
    React.useCallback(() => {
      setShowDetailModal(false);
      setSelectedLocation(null);
      setShowReviewModal(false);
      setShowReviewsModal(false);
    }, [])
  );

  useEffect(() => {
    if (!openLocationId) return;
    if (openedLocationRef.current === openLocationId) return;
    const match = locations.find((l) => l.id === openLocationId);
    if (match) {
      openedLocationRef.current = openLocationId;
      openDetailModal(match);
      try {
        router.setParams({ openLocationId: undefined });
      } catch {
        // no-op
      }
      return;
    }

    // Fallback: fetch the location if it's not in the current list
    (async () => {
      try {
        const fetched = await apiService.getLocation(openLocationId);
        if (!fetched || openedLocationRef.current === openLocationId) return;
        openedLocationRef.current = openLocationId;
        openDetailModal(fetched);
        setLocations((prev) => {
          if (prev.find((l) => l.id === fetched.id)) return prev;
          return [fetched, ...prev];
        });
        try {
          router.setParams({ openLocationId: undefined });
        } catch {
          // no-op
        }
      } catch (error) {
      }
    })();
  }, [openLocationId, locations]);

  const loadLocations = async (search?: string) => {
    setLoading(true);
    try {
      const data = await apiService.getLocations({
        search: search || undefined,
      });
      setLocations(Array.isArray(data) ? data : []);
    } catch (error) {
      setLocations([]);
    } finally {
      setLoading(false);
    }
  };

  const loadFavorites = async () => {
    try {
      const data = await apiService.getFavorites();
      const list = Array.isArray(data) ? data : [];
      setFavorites(list);
      setFavoriteIds(list.map((l: Location) => l.id));
    } catch (error) {
      setFavorites([]);
      setFavoriteIds([]);
    }
  };

  const loadReviews = async (locationId: string) => {
    try {
      const data = await apiService.getReviews(locationId);
      setReviews(Array.isArray(data) ? data : []);
    } catch (error) {
      setReviews([]);
    }
  };

  const loadActivityRatings = async (locationId: string) => {
    setActivityRatingsLoading(true);
    try {
      const data = await apiService.getLocationActivityRatings(locationId);
      setActivityRatings(data);
    } catch (error) {
      setActivityRatings({ ratings: [], can_rate: true, cooldown_until: null });
    } finally {
      setActivityRatingsLoading(false);
    }
  };

  const toggleFavorite = async (locationId: string, location?: Location) => {
    try {
      if (favoriteIds.includes(locationId)) {
        await apiService.removeFavorite(locationId);
        setFavoriteIds((prev) => prev.filter((id) => id !== locationId));
        setFavorites((prev) => prev.filter((l) => l.id !== locationId));
      } else {
        await apiService.addFavorite(locationId);
        setFavoriteIds((prev) => [...prev, locationId]);
        if (location) setFavorites((prev) => [...prev, location]);
      }
    } catch (error: any) {
      const msg = typeof error?.response?.data?.detail === 'string'
        ? error.response.data.detail
        : 'Could not update favorite. Try again.';
      Alert.alert('Error', msg);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (placesView === 'favorites') {
        await loadFavorites();
      } else {
        await loadLocations(searchTerm);
      }
    } catch (error) {
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearch = (text: string) => {
    setSearchTerm(text);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (text.trim().length === 0) {
      if (placesView === 'all') loadLocations('');
      return;
    }
    if (placesView === 'all') {
      debounceTimerRef.current = setTimeout(() => loadLocations(text), 500);
    }
  };

  const listData: Location[] =
    placesView === 'all'
      ? locations
      : favorites.filter(
          (l) =>
            !searchTerm.trim() ||
            l.name.toLowerCase().includes(searchTerm.trim().toLowerCase()) ||
            (l.address && l.address.toLowerCase().includes(searchTerm.trim().toLowerCase()))
        );

  const handleViewReviews = async (location: Location) => {
    setSelectedLocation(location);
    await loadReviews(location.id);
    setShowReviewsModal(true);
  };

  const handleSubmitReview = async () => {
    if (!selectedLocation) return;
    
    if (reviewRating === 0) {
      Alert.alert('Error', 'Please select a rating');
      return;
    }

    try {
      await apiService.createReview(selectedLocation.id, reviewRating, reviewText);
      Alert.alert('Success', 'Review submitted!');
      setShowReviewModal(false);
      setReviewText('');
      setReviewRating(0);
      loadLocations(searchTerm);
      // Reload reviews for the selected location
      await loadReviews(selectedLocation.id);
    } catch (error: any) {
      if (error.response?.status === 401) {
        Alert.alert('Authentication Error', 'Please log in again to submit a review');
      } else if (error.response?.status === 400 && error.response?.data?.detail?.includes('already reviewed')) {
        Alert.alert('Unable to Leave Review', 'You can only leave one review per location. If you would like to update your existing review, please delete it first and create a new one.');
        setShowReviewModal(false);
      } else {
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to submit review';
        Alert.alert('Error', errorMessage);
      }
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    Alert.alert(
      'Delete Location',
      'Are you sure you want to delete this location? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.deleteLocation(locationId);
              Alert.alert('Success', 'Location deleted successfully');
              loadLocations(searchTerm);
              if (showDetailModal) {
                setShowDetailModal(false);
              }
            } catch (error: any) {
              const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to delete location';
              if (error?.response?.status === 401) {
                Alert.alert('Authentication Error', 'Please log in again to delete a location');
              } else if (error?.response?.status === 403) {
                Alert.alert('Permission Denied', 'Only administrators can delete locations');
              } else {
                Alert.alert('Error', errorMessage);
              }
            }
          },
        },
      ]
    );
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!selectedLocation) return;
    
    Alert.alert(
      'Delete Review',
      'Are you sure you want to delete this review? This action cannot be undone.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.deleteReview(reviewId);
              Alert.alert('Success', 'Review deleted successfully');
              await loadReviews(selectedLocation.id);
              loadLocations(searchTerm);
            } catch (error: any) {
              const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to delete review';
              if (error?.response?.status === 401) {
                Alert.alert('Authentication Error', 'Please log in again to delete a review');
              } else if (error?.response?.status === 403) {
                Alert.alert('Permission Denied', 'Only administrators can delete reviews');
              } else {
                Alert.alert('Error', errorMessage);
              }
            }
          },
        },
      ]
    );
  };

  const openReviewModal = (location: Location) => {
    setSelectedLocation(location);
    setShowReviewModal(true);
  };

  const openDetailModal = async (location: Location) => {
    setSelectedLocation(location);
    await loadReviews(location.id);
    await loadActivityRatings(location.id);
    setShowDetailModal(true);
  };

  const parseQualities = (text?: string): string[] => {
    if (!text) return [];
    // Split by comma, semicolon, or newline
    return text
      .split(/[,;\n]/)
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 4); // Limit to 4 qualities
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

const countQualities = (text?: string) => {
  if (!text) return 0;
  return text
    .split(/[,;\n]/)
    .map((q) => q.trim())
    .filter(Boolean).length;
};

  const pickRequestLocationImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setRequestLocationImage(result.assets[0].uri);
    }
  };

  const handleSubmitLocationRequest = async () => {
    if (!requestLocationName.trim() || !requestLocationAddress.trim()) {
      Alert.alert('Error', 'Please fill in name and address');
      return;
    }
    if (countQualities(requestLocationTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }
    setRequestLocationSubmitting(true);
    try {
      let pictures;
      if (requestLocationImage) {
        if (requestLocationImage.startsWith('file://')) {
          const resp = await fetch(requestLocationImage);
          const bl = await resp.blob();
          const img = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onloadend = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(bl);
          });
          pictures = [{ url: img, caption: requestLocationTopQualities }];
        } else {
          pictures = [{ url: requestLocationImage, caption: requestLocationTopQualities }];
        }
      }
      await apiService.createLocationRequest({
        name: requestLocationName.trim(),
        address: requestLocationAddress.trim(),
        description: requestLocationDescription.trim() || undefined,
        most_known_for: requestLocationTopQualities.trim() || undefined,
        level_of_business: requestLocationLevel || undefined,
        pictures,
      });
      Alert.alert('Submitted', 'Your location request was sent. An admin will review it.');
      setShowRequestLocationModal(false);
      setRequestLocationName('');
      setRequestLocationAddress('');
      setRequestLocationDescription('');
      setRequestLocationTopQualities('');
      setRequestLocationLevel('');
      setRequestLocationImage(null);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to submit request');
    } finally {
      setRequestLocationSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#5FA8D3" />
          <ThemedText style={styles.loadingText}>Loading places...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <ThemedText type="title" style={styles.headerTitle}>
              Places
            </ThemedText>
            <ThemedText style={styles.headerSubtitle}>
              Discover locations around campus
            </ThemedText>
          </View>
          {user?.role !== 'admin' && (
            <TouchableOpacity
              style={styles.headerPlusButton}
              onPress={() => setShowRequestLocationModal(true)}
              activeOpacity={0.7}>
              <IconSymbol name="plus.circle.fill" size={28} color="#5FA8D3" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.searchContainer}>
            <View style={styles.searchWrapper}>
              <TextInput
                style={styles.searchInput}
                placeholder={placesView === 'favorites' ? 'Search favorites...' : 'Search places...'}
                placeholderTextColor="#888888"
                value={searchTerm}
                onChangeText={handleSearch}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
                  if (placesView === 'all') loadLocations(searchTerm);
                  Keyboard.dismiss();
                }}
                blurOnSubmit={true}
              />
            </View>
          </View>

      <View style={styles.placesViewToggle}>
        <TouchableOpacity
          style={[styles.placesViewTab, placesView === 'all' && styles.placesViewTabActive]}
          onPress={() => setPlacesView('all')}
          activeOpacity={0.7}>
          <ThemedText style={[styles.placesViewTabText, placesView === 'all' && styles.placesViewTabTextActive]}>
            All
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.placesViewTab, placesView === 'favorites' && styles.placesViewTabActive]}
          onPress={() => setPlacesView('favorites')}
          activeOpacity={0.7}>
          <ThemedText style={[styles.placesViewTabText, placesView === 'favorites' && styles.placesViewTabTextActive]}>
            Favorites
          </ThemedText>
        </TouchableOpacity>
      </View>


      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => {
          const qualities = parseQualities(item.most_known_for);
          const primaryImage = item.pictures?.[0]?.url;

          return (
            <TouchableOpacity
              style={styles.locationCard}
              onPress={() => openDetailModal(item)}
              activeOpacity={0.9}>
              {/* Image */}
              {primaryImage ? (
                <Image
                  source={{ uri: primaryImage }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                  <ThemedText style={styles.placeholderText}>No Image</ThemedText>
                </View>
              )}

              <View style={styles.cardContent}>
                {/* Name and Rating */}
                <View style={styles.cardHeader}>
                  <View style={styles.nameRatingContainer}>
                    <ThemedText style={styles.locationName}>{item.name}</ThemedText>
                    <View style={styles.ratingContainer}>
                      <ThemedText style={styles.ratingIcon}>★</ThemedText>
                      <ThemedText style={styles.ratingText}>
                        {item.rating?.toFixed(1) || '0.0'}
                      </ThemedText>
                      {item.reviews_count !== undefined && item.reviews_count > 0 && (
                        <ThemedText style={styles.reviewCount}>
                          ({item.reviews_count})
                        </ThemedText>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardHeaderRight}>
                    <TouchableOpacity
                      onPress={() => toggleFavorite(item.id, item)}
                      style={styles.heartButton}
                      activeOpacity={0.7}>
                      <IconSymbol
                        name={favoriteIds.includes(item.id) ? 'heart.fill' : 'heart'}
                        size={22}
                        color={favoriteIds.includes(item.id) ? '#FF6B6B' : '#8B7355'}
                      />
                    </TouchableOpacity>
                    {user?.role === 'admin' && (
                      <TouchableOpacity
                        style={styles.deleteIconButton}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeleteLocation(item.id);
                        }}
                        activeOpacity={0.7}>
                        <IconSymbol name="trash.fill" size={20} color="#FF6B6B" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {item.level_of_business ? (
                  <View style={styles.cardBusinessBlock}>
                    <ThemedText style={styles.cardBusinessLabel}>Activity Level: </ThemedText>
                    <View
                      style={[
                        styles.businessBadge,
                        { backgroundColor: getBusinessLevelColor(item.level_of_business) },
                      ]}>
                      <ThemedText style={styles.businessBadgeText}>
                        {item.level_of_business}
                      </ThemedText>
                    </View>
                  </View>
                ) : null}

                {/* Address */}
                <ThemedText style={styles.address}>{item.address}</ThemedText>

                {/* Description */}
                {item.most_known_for && !qualities.length && (
                  <ThemedText style={styles.description} numberOfLines={2}>
                    {item.most_known_for}
                  </ThemedText>
                )}

                {/* Qualities as boxes */}
                {qualities.length > 0 && (
                  <View style={styles.qualitiesContainer}>
                    {qualities.map((quality, index) => (
                      <View key={index} style={styles.qualityBox}>
                        <ThemedText style={styles.qualityText}>{quality}</ThemedText>
                      </View>
                    ))}
                  </View>
                )}

                {/* Reviews section */}
                <View style={styles.reviewsSection}>
                  <TouchableOpacity
                    style={styles.reviewButton}
                    onPress={() => handleViewReviews(item)}>
                    <ThemedText style={styles.reviewButtonText}>
                      View Reviews ({item.reviews_count || 0})
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.addReviewButton}
                    onPress={() => openReviewModal(item)}>
                    <ThemedText style={styles.addReviewButtonText}>Leave Review</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>
              {placesView === 'favorites'
                ? searchTerm
                  ? 'No favorites match your search'
                  : 'No favorite places yet'
                : searchTerm
                  ? 'No places found'
                  : 'No places available'}
            </ThemedText>
          </View>
        }
      />

      {/* Request Location Modal (students) */}
      <Modal
        visible={showRequestLocationModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowRequestLocationModal(false)}>
        <View style={styles.detailModalContainer} {...requestLocationSwipeResponder.panHandlers}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setShowRequestLocationModal(false)}>
              <ThemedText style={styles.backButton}>←</ThemedText>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.requestScrollContent}
            keyboardShouldPersistTaps="handled">
            <View style={styles.requestForm}>
              <View style={styles.requestFormTitleContainer}>
                <ThemedText style={styles.requestFormTitle}>Request a new location</ThemedText>
              </View>

              <View style={styles.requestInputGroup}>
                <ThemedText style={styles.requestLabel}>Location name *</ThemedText>
                <TextInput
                  style={styles.requestInput}
                  placeholder="Location name"
                  placeholderTextColor="#888888"
                  value={requestLocationName}
                  onChangeText={setRequestLocationName}
                maxLength={MAX_NAME_LEN}
                />
              </View>

              <View style={styles.requestInputGroup}>
                <ThemedText style={styles.requestLabel}>Address *</ThemedText>
                <TextInput
                  style={[styles.requestInput, styles.requestTextArea]}
                  placeholder="Full address"
                  placeholderTextColor="#888888"
                  value={requestLocationAddress}
                  onChangeText={setRequestLocationAddress}
                  multiline
                />
              </View>

              <View style={styles.requestInputGroup}>
                <ThemedText style={styles.requestLabel}>Description (optional)</ThemedText>
                <TextInput
                  style={[styles.requestInput, styles.requestTextArea]}
                  placeholder="Short description"
                  placeholderTextColor="#888888"
                  value={requestLocationDescription}
                  onChangeText={setRequestLocationDescription}
                  multiline
                />
              </View>

              <View style={styles.requestInputGroup}>
                <ThemedText style={styles.requestLabel}>Top qualities</ThemedText>
                <TextInput
                  style={[styles.requestInput, styles.requestTextArea]}
                  placeholder="Coffee, WiFi, Quiet"
                  placeholderTextColor="#888888"
                  value={requestLocationTopQualities}
                  onChangeText={setRequestLocationTopQualities}
                  multiline
                />
                <ThemedText style={styles.requestHint}>
                  Use commas to create bubbles (e.g., Coffee, WiFi, Quiet).
                </ThemedText>
              </View>

              <View style={styles.requestInputGroup}>
                <ThemedText style={styles.requestLabel}>Level of business</ThemedText>
                <View style={styles.requestButtonRow}>
                  {(['low', 'moderate', 'high'] as const).map((lvl) => (
                    <TouchableOpacity
                      key={lvl}
                      style={[
                        styles.requestLevelButton,
                        requestLocationLevel === lvl && styles.requestLevelButtonActive,
                      ]}
                      onPress={() => setRequestLocationLevel(lvl)}
                      activeOpacity={0.7}>
                      <ThemedText
                        style={[
                          styles.requestLevelButtonText,
                          requestLocationLevel === lvl && styles.requestLevelButtonTextActive,
                        ]}>
                        {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.requestInputGroup}>
                <ThemedText style={styles.requestLabel}>Image (optional)</ThemedText>
                <TouchableOpacity
                  style={styles.requestImageButton}
                  onPress={pickRequestLocationImage}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.requestImageButtonText}>
                    {requestLocationImage ? 'Change Image' : 'Choose from Camera Roll'}
                  </ThemedText>
                </TouchableOpacity>
                {requestLocationImage ? (
                  <Image source={{ uri: requestLocationImage }} style={styles.requestImagePreview} />
                ) : null}
              </View>

              <TouchableOpacity
                style={[
                  styles.requestSubmitButton,
                  (requestLocationSubmitting || !requestLocationName.trim() || !requestLocationAddress.trim()) && {
                    opacity: 0.6,
                  },
                ]}
                disabled={requestLocationSubmitting || !requestLocationName.trim() || !requestLocationAddress.trim()}
                onPress={handleSubmitLocationRequest}
                activeOpacity={0.7}>
                <ThemedText style={styles.requestSubmitButtonText}>
                  {requestLocationSubmitting ? 'Submitting...' : 'Submit Request'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Review Modal */}
      <Modal
        visible={showReviewModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowReviewModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.reviewModalContent} {...reviewSwipeResponder.panHandlers}>
                <View style={styles.modalHeader}>
                  <ThemedText style={styles.modalTitle}>Leave a Review</ThemedText>
                  <TouchableOpacity onPress={() => setShowReviewModal(false)}>
                    <ThemedText style={styles.modalClose}>✕</ThemedText>
                  </TouchableOpacity>
                </View>

                {selectedLocation && (
                  <ThemedText style={styles.modalLocationName}>{selectedLocation.name}</ThemedText>
                )}

                <View style={styles.ratingSelector}>
                  <ThemedText style={styles.ratingLabel}>Rating:</ThemedText>
                  <View style={styles.starContainer}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity
                        key={star}
                        onPress={() => setReviewRating(star)}
                        style={styles.starButton}>
                        <ThemedText
                          style={[
                            styles.star,
                            reviewRating > 0 && star <= reviewRating && styles.starActive,
                          ]}>
                          ★
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <ThemedText style={styles.reviewTextLabel}>Your Review:</ThemedText>
                <TextInput
                  style={styles.reviewTextInput}
                  placeholder="Share your experience..."
                  placeholderTextColor="#888888"
                  value={reviewText}
                  onChangeText={setReviewText}
                  multiline
                  numberOfLines={6}
                  returnKeyType="done"
                  blurOnSubmit={true}
                />

                <TouchableOpacity 
                  style={[styles.submitReviewButton, reviewRating === 0 && styles.submitReviewButtonDisabled]} 
                  onPress={handleSubmitReview}
                  disabled={reviewRating === 0}>
                  <ThemedText style={styles.submitReviewButtonText}>Submit Review</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Instagram-style Detail Modal */}
      <Modal
        visible={showDetailModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowDetailModal(false)}>
        {selectedLocation && (
          <View style={styles.detailModalContainer} {...detailSwipeResponder.panHandlers}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <ThemedText style={styles.backButton}>←</ThemedText>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                onPress={() => toggleFavorite(selectedLocation.id, selectedLocation)}
                style={{ padding: 8 }}
                activeOpacity={0.7}>
                <IconSymbol
                  name={favoriteIds.includes(selectedLocation.id) ? 'heart.fill' : 'heart'}
                  size={24}
                  color={favoriteIds.includes(selectedLocation.id) ? '#FF6B6B' : '#8B7355'}
                />
              </TouchableOpacity>
              {user?.role === 'admin' ? (
                <TouchableOpacity
                  style={styles.deleteIconButton}
                  onPress={() => handleDeleteLocation(selectedLocation.id)}
                  activeOpacity={0.7}>
                  <IconSymbol name="trash.fill" size={20} color="#FF6B6B" />
                </TouchableOpacity>
              ) : (
                <View style={{ width: 40 }} />
              )}
            </View>

            <ScrollView
              style={styles.detailScrollView}
              contentContainerStyle={styles.detailContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag">
              {selectedLocation.pictures?.[0]?.url ? (
                <Image
                  source={{ uri: selectedLocation.pictures[0].url }}
                  style={styles.detailImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.detailImage, styles.detailImagePlaceholder]}>
                  <ThemedText style={styles.placeholderText}>No Image</ThemedText>
                </View>
              )}

              {selectedLocation.description ? (
                <ThemedText style={styles.detailDescriptionUnderImage}>{selectedLocation.description}</ThemedText>
              ) : null}

              <View style={styles.detailInfo}>
                <View style={styles.detailNameRow}>
                  <ThemedText style={styles.detailName}>{selectedLocation.name}</ThemedText>
                  <View style={styles.detailRatingRow}>
                    <ThemedText style={styles.detailRatingIcon}>★</ThemedText>
                    <ThemedText style={styles.detailRatingText}>
                      {selectedLocation.rating?.toFixed(1) || '0.0'}
                    </ThemedText>
                  </View>
                </View>

                {selectedLocation.level_of_business ? (
                  <View style={styles.detailBusinessBlock}>
                    <ThemedText style={styles.detailBusinessLabel}>Level of business:</ThemedText>
                    <View
                      style={[
                        styles.detailBusinessBadge,
                        { backgroundColor: getBusinessLevelColor(selectedLocation.level_of_business) },
                      ]}>
                      <ThemedText style={styles.detailBusinessText}>
                        {selectedLocation.level_of_business}
                      </ThemedText>
                    </View>
                  </View>
                ) : null}

                <View style={styles.rateActivityBlock}>
                  <ThemedText style={styles.rateActivityLabel}>Rate level of activity</ThemedText>
                  {activityRatingsLoading ? (
                    <ActivityIndicator size="small" color="#5FA8D3" style={{ marginVertical: 8 }} />
                  ) : !activityRatings?.can_rate && activityRatings?.cooldown_until ? (
                    <ThemedText style={styles.rateActivityCooldown}>
                      You can rate again in {(() => {
                        const totalMins = Math.max(0, Math.ceil((new Date(activityRatings!.cooldown_until!).getTime() - Date.now()) / 60000));
                        const hrs = Math.floor(totalMins / 60);
                        const mins = totalMins % 60;
                        if (hrs > 0 && mins > 0) return `${hrs} hr${hrs !== 1 ? 's' : ''} and ${mins} min${mins !== 1 ? 's' : ''}`;
                        if (hrs > 0) return `${hrs} hr${hrs !== 1 ? 's' : ''}`;
                        return `${mins} min${mins !== 1 ? 's' : ''}`;
                      })()}
                    </ThemedText>
                  ) : (
                    <View style={styles.rateActivityButtons}>
                      {(['low', 'moderate', 'high'] as const).map((lvl) => (
                        <TouchableOpacity
                          key={lvl}
                          style={[
                            styles.rateActivityBtn,
                            { borderColor: getBusinessLevelColor(lvl), backgroundColor: getBusinessLevelColor(lvl) + '22' },
                          ]}
                          onPress={async () => {
                            if (!selectedLocation || activityRateSubmitting) return;
                            setActivityRateSubmitting(true);
                            try {
                              await apiService.submitLocationActivityRating(selectedLocation.id, lvl);
                              await loadActivityRatings(selectedLocation.id);
                            } catch (e: any) {
                              const msg = e?.response?.data?.detail || e?.message || 'Failed to submit';
                              Alert.alert('Error', msg);
                            } finally {
                              setActivityRateSubmitting(false);
                            }
                          }}
                          disabled={activityRateSubmitting}
                          activeOpacity={0.7}>
                          <ThemedText style={[styles.rateActivityBtnText, { color: getBusinessLevelColor(lvl) }]}>
                            {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <ThemedText style={styles.detailAddress}>{selectedLocation.address}</ThemedText>

                {selectedLocation.most_known_for && parseQualities(selectedLocation.most_known_for).length === 0 && (
                  <ThemedText style={styles.detailDescription}>{selectedLocation.most_known_for}</ThemedText>
                )}

                {parseQualities(selectedLocation.most_known_for).length > 0 && (
                  <View style={styles.detailQualities}>
                    {parseQualities(selectedLocation.most_known_for).map((quality, index) => (
                      <View key={index} style={styles.detailQualityBox}>
                        <ThemedText style={styles.detailQualityText}>{quality}</ThemedText>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.detailActions}>
                  <TouchableOpacity
                    style={styles.detailActionButton}
                    onPress={() => {
                      setShowDetailModal(false);
                      openReviewModal(selectedLocation);
                    }}>
                    <ThemedText style={styles.detailActionText}>✍️ Leave Review</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.detailReviewsSection}>
                <View style={styles.detailReviewsHeader}>
                  <ThemedText style={styles.detailReviewsTitle}>
                    Reviews ({selectedLocation.reviews_count || 0})
                  </ThemedText>
                </View>

                {reviews.length === 0 ? (
                  <View style={styles.noReviewsContainer}>
                    <ThemedText style={styles.noReviewsText}>No reviews yet</ThemedText>
                    <ThemedText style={styles.noReviewsSubtext}>
                      Be the first to review this location!
                    </ThemedText>
                  </View>
                ) : (
                  reviews.map((review) => (
                    <View key={review.id} style={styles.reviewComment}>
                      <View style={styles.reviewCommentHeader}>
                        <View style={styles.reviewAuthorContainer}>
                          {review.user_profile_pic ? (
                            <Image 
                              source={{ uri: review.user_profile_pic }} 
                              style={styles.reviewAuthorAvatar}
                            />
                          ) : (
                            <View style={styles.reviewAuthorAvatar}>
                              <ThemedText style={styles.reviewAuthorAvatarText}>
                                {review.user_name?.charAt(0).toUpperCase() || 'U'}
                              </ThemedText>
                            </View>
                          )}
                          <ThemedText style={styles.reviewCommentAuthor}>
                            {review.user_name}{review.user_role ? ` - ${review.user_role}` : ''}
                          </ThemedText>
                        </View>
                        <View style={styles.reviewCommentRating}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <ThemedText
                              key={star}
                              style={[
                                styles.reviewCommentStar,
                                star <= review.rating && styles.reviewCommentStarActive,
                              ]}>
                              ★
                            </ThemedText>
                          ))}
                        </View>
                      </View>
                      {review.review_text && (
                        <ThemedText style={styles.reviewCommentText}>{review.review_text}</ThemedText>
                      )}
                      <View style={styles.reviewCommentFooter}>
                        <ThemedText style={styles.reviewCommentDate}>
                          {new Date(review.created_at).toLocaleDateString()}
                        </ThemedText>
                        {user?.role === 'admin' && (
                          <TouchableOpacity
                            style={styles.deleteReviewButton}
                            onPress={() => handleDeleteReview(review.id)}
                            activeOpacity={0.7}>
                            <ThemedText style={styles.deleteReviewButtonText}>Delete</ThemedText>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.activityGraphSection}>
                <ThemedText style={styles.activityGraphTitle}>Activity level (last 24 hours)</ThemedText>
                <ActivityLevelGraph ratings={activityRatings?.ratings ?? []} getColor={getBusinessLevelColor} />
              </View>

              <View style={styles.getDirectionsWrap}>
                <TouchableOpacity
                  style={styles.getDirectionsButton}
                  onPress={() => {
                    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedLocation.address)}&travelmode=driving`;
                    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open maps'));
                  }}
                  activeOpacity={0.7}>
                  <ThemedText style={styles.getDirectionsButtonText}>Get Directions</ThemedText>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Reviews List Modal */}
      <Modal
        visible={showReviewsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowReviewsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} {...reviewsSwipeResponder.panHandlers}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>
                Reviews {selectedLocation && `- ${selectedLocation.name}`}
              </ThemedText>
              <TouchableOpacity onPress={() => setShowReviewsModal(false)}>
                <ThemedText style={styles.modalClose}>✕</ThemedText>
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.reviewsList}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag">
              {reviews.length === 0 ? (
                <ThemedText style={styles.noReviewsText}>No reviews yet</ThemedText>
              ) : (
                reviews.map((review) => (
                  <View key={review.id} style={styles.reviewItem}>
                    <View style={styles.reviewHeader}>
                      <View style={styles.reviewAuthorContainer}>
                        {review.user_profile_pic ? (
                          <Image 
                            source={{ uri: review.user_profile_pic }} 
                            style={styles.reviewAuthorAvatar}
                          />
                        ) : (
                          <View style={styles.reviewAuthorAvatar}>
                            <ThemedText style={styles.reviewAuthorAvatarText}>
                              {review.user_name?.charAt(0).toUpperCase() || 'U'}
                            </ThemedText>
                          </View>
                        )}
                        <ThemedText style={styles.reviewAuthor}>
                          {review.user_name}{review.user_role ? ` - ${review.user_role}` : ''}
                        </ThemedText>
                      </View>
                      <View style={styles.reviewRating}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <ThemedText
                            key={star}
                            style={[
                              styles.reviewStar,
                              star <= review.rating && styles.reviewStarActive,
                            ]}>
                            ★
                          </ThemedText>
                        ))}
                      </View>
                    </View>
                    {review.review_text && (
                      <ThemedText style={styles.reviewText}>{review.review_text}</ThemedText>
                    )}
                    <View style={styles.reviewFooter}>
                      <ThemedText style={styles.reviewDate}>
                        {new Date(review.created_at).toLocaleDateString()}
                      </ThemedText>
                      {user?.role === 'admin' && (
                        <TouchableOpacity
                          style={styles.deleteReviewButton}
                          onPress={() => handleDeleteReview(review.id)}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.deleteReviewButtonText}>Delete</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      </ThemedView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
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
  headerContainer: {
    paddingTop: 90,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderBottomColor: '#E8D5C4',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerPlusButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 4,
    textAlign: 'left',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#8B7355',
    fontWeight: '400',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
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
  placesViewToggle: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
    gap: 8,
  },
  placesViewTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  placesViewTabActive: {
    backgroundColor: '#5FA8D3',
  },
  placesViewTabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8B7355',
  },
  placesViewTabTextActive: {
    color: '#FFFFFF',
  },
  list: {
    padding: 16,
    paddingTop: 12,
  },
  locationCard: {
    marginBottom: 24,
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
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameRatingContainer: {
    flex: 1,
    marginRight: 12,
  },
  locationName: {
    fontSize: 22,
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
  description: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 22,
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
  reviewsSection: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8D5C4',
  },
  reviewButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  reviewButtonText: {
    fontSize: 14,
    color: '#5FA8D3',
    fontWeight: '600',
  },
  addReviewButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#5FA8D3',
    alignItems: 'center',
  },
  addReviewButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#8B7355',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    padding: 20,
  },
  reviewModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
    marginTop: '15%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2C3E50',
  },
  modalClose: {
    fontSize: 28,
    color: '#8B7355',
    fontWeight: '300',
  },
  modalLocationName: {
    fontSize: 18,
    color: '#5FA8D3',
    marginBottom: 20,
    fontWeight: '600',
  },
  ratingSelector: {
    marginBottom: 20,
  },
  ratingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 12,
  },
  starContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 48,
  },
  starButton: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 48,
    minWidth: 48,
  },
  star: {
    fontSize: 32,
    color: '#E0E0E0',
    lineHeight: 36,
    textAlign: 'center',
  },
  starActive: {
    color: '#FFB800',
  },
  reviewTextLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 12,
  },
  reviewTextInput: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    padding: 16,
    fontSize: 16,
    color: '#2C3E50',
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  submitReviewButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitReviewButtonDisabled: {
    backgroundColor: '#CCCCCC',
    opacity: 0.6,
  },
  submitReviewButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  reviewsList: {
    maxHeight: 500,
  },
  reviewItem: {
    paddingBottom: 16,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewAuthor: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2C3E50',
    flex: 1,
  },
  reviewRating: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewStar: {
    fontSize: 14,
    color: '#E0E0E0',
  },
  reviewStarActive: {
    color: '#FFB800',
  },
  reviewText: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 22,
    marginBottom: 8,
  },
  reviewDate: {
    fontSize: 12,
    color: '#8B7355',
  },
  reviewFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  noReviewsText: {
    fontSize: 16,
    color: '#8B7355',
    textAlign: 'center',
    padding: 40,
  },
  // Instagram-style Detail Modal styles
  detailModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    fontSize: 28,
    color: '#2C3E50',
    fontWeight: '300',
    width: 40,
  },
  detailHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    flex: 1,
    textAlign: 'center',
  },
  detailScrollView: {
    flex: 1,
  },
  detailContent: {
    paddingBottom: 40,
  },
  detailImage: {
    width: '100%',
    height: 400,
    backgroundColor: '#F0F0F0',
  },
  detailImagePlaceholder: {
    backgroundColor: '#E8D5C4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailInfo: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  detailNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2C3E50',
    flex: 1,
  },
  detailRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailRatingIcon: {
    fontSize: 20,
    color: '#FFB800',
  },
  detailRatingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2C3E50',
  },
  detailBusinessBlock: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  detailBusinessLabel: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 6,
  },
  detailBusinessBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  detailBusinessText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  rateActivityBlock: {
    marginBottom: 16,
  },
  rateActivityLabel: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 8,
  },
  rateActivityCooldown: {
    fontSize: 14,
    color: '#4B5563',
    fontWeight: '600',
  },
  rateActivityButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  rateActivityBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 2,
  },
  rateActivityBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailAddress: {
    fontSize: 15,
    color: '#8B7355',
    marginBottom: 12,
  },
  detailDescription: {
    fontSize: 16,
    color: '#2C3E50',
    lineHeight: 24,
    marginBottom: 12,
  },
  detailDescriptionUnderImage: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  detailQualities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  detailQualityBox: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#E8F4F8',
    borderWidth: 1,
    borderColor: '#5FA8D3',
  },
  detailQualityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5FA8D3',
  },
  detailActions: {
    marginTop: 8,
  },
  detailActionButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  detailActionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  activityGraphSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  activityGraphTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 4,
  },
  getDirectionsWrap: {
    padding: 20,
    paddingTop: 0,
  },
  getDirectionsButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  getDirectionsButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  detailReviewsSection: {
    padding: 20,
    backgroundColor: '#F8F8F8',
  },
  detailReviewsHeader: {
    marginBottom: 16,
  },
  detailReviewsTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
  },
  noReviewsContainer: {
    padding: 40,
    alignItems: 'center',
  },
  noReviewsSubtext: {
    fontSize: 14,
    color: '#8B7355',
    marginTop: 8,
  },
  reviewComment: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8D5C4',
  },
  reviewCommentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewAuthorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  reviewAuthorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#5FA8D3',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  reviewAuthorAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reviewCommentAuthor: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2C3E50',
  },
  reviewCommentRating: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewCommentStar: {
    fontSize: 14,
    color: '#E0E0E0',
  },
  reviewCommentStarActive: {
    color: '#FFB800',
  },
  reviewCommentText: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 22,
    marginBottom: 8,
  },
  reviewCommentDate: {
    fontSize: 12,
    color: '#8B7355',
  },
  reviewCommentFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  deleteReviewButton: {
    backgroundColor: '#FF6B6B',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  deleteIconButton: {
    padding: 4,
  },
  heartButton: {
    padding: 4,
  },
  deleteReviewButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  // Tab Switcher styles
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#5FA8D3',
  },
  tabButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8B7355',
  },
  tabButtonTextActive: {
    color: '#5FA8D3',
  },
  // Request styles
  requestScrollContent: {
    padding: 20,
    paddingTop: 16,
  },
  requestForm: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  requestFormTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  requestFormTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
  },
  requestInputGroup: {
    marginBottom: 16,
  },
  requestLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5FA8D3',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  requestInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#2C3E50',
  },
  requestTextArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  requestHint: {
    fontSize: 12,
    color: '#8B7355',
    marginTop: 6,
  },
  requestButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  requestLevelButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  requestLevelButtonActive: {
    backgroundColor: '#5FA8D3',
    borderColor: '#5FA8D3',
  },
  requestLevelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
  },
  requestLevelButtonTextActive: {
    color: '#FFFFFF',
  },
  requestSubmitButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  requestSubmitButtonDisabled: {
    opacity: 0.6,
  },
  requestSubmitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  requestImageButton: {
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  requestImageButtonText: {
    color: '#5FA8D3',
    fontSize: 14,
    fontWeight: '600',
  },
  requestImagePreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 8,
  },
  myRequestsSection: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 16,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  requestName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    flex: 1,
  },
  requestAddress: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 8,
  },
  requestDescription: {
    fontSize: 15,
    color: '#2C3E50',
    marginBottom: 8,
    lineHeight: 22,
  },
  requestLevel: {
    fontSize: 14,
    color: '#5FA8D3',
    marginBottom: 8,
  },
  requestBy: {
    fontSize: 13,
    color: '#8B7355',
    marginBottom: 12,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#5FA8D3',
  },
  denyButton: {
    backgroundColor: '#FF6B6B',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#E8D5C4',
  },
  statusApproved: {
    backgroundColor: '#5FA8D3',
  },
  statusDenied: {
    backgroundColor: '#FF6B6B',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  adminNotes: {
    fontSize: 13,
    color: '#8B7355',
    fontStyle: 'italic',
    marginTop: 8,
  },
  deleteButton: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  detailLevelContainer: {
    marginBottom: 12,
  },
  detailLevel: {
    fontSize: 15,
    color: '#5FA8D3',
    fontWeight: '600',
  },
  detailRequestedBy: {
    fontSize: 14,
    color: '#8B7355',
    marginBottom: 12,
  },
  detailNotesContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
  },
  detailNotesLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 6,
  },
  detailNotes: {
    fontSize: 14,
    color: '#8B7355',
    lineHeight: 20,
  },
});
