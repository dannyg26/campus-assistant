import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Keyboard,
  TouchableWithoutFeedback,
  RefreshControl,
  PanResponder,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { apiService } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

const MAX_LOCATION_NAME_LEN = 200;
const MAX_EVENT_NAME_LEN = 500;
const MAX_ANNOUNCEMENT_TITLE_LEN = 500;
const MAX_QUALITIES = 6;
const MAX_IMAGE_BYTES = 800_000;

const countQualities = (text?: string) => {
  if (!text) return 0;
  return text
    .split(/[,;\n]/)
    .map((q) => q.trim())
    .filter(Boolean).length;
};

const buildPicturesFromUris = (uris: string[], caption?: string) => {
  if (!uris.length) return undefined;
  // Just pass URIs directly - backend will handle them
  const pictures = uris
    .filter((uri) => uri && !uri.startsWith('ph://')) // Skip iOS ph:// URIs
    .map((uri) => ({ url: uri, caption }));
  return pictures.length > 0 ? pictures : undefined;
};

const getPickerAssetUri = (asset: ImagePicker.ImagePickerAsset) => {
  if (!asset) return '';
  if (asset.base64) {
    const approxBytes = Math.floor((asset.base64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      Alert.alert('Image too large', 'Please choose a smaller image.');
      return '';
    }
    const mimeType = asset.mimeType || 'image/jpeg';
    return `data:${mimeType};base64,${asset.base64}`;
  }
  return asset.uri;
};

const getSafeUploadImage = (image: string | null | undefined) => {
  if (!image) return undefined;
  if (image.startsWith('ph://') || image.startsWith('file://')) {
    Alert.alert('Image not supported', 'Please reselect the image.');
    return undefined;
  }
  if (image.startsWith('data:')) {
    const base64 = image.split(',')[1] || '';
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      Alert.alert('Image too large', 'Please choose a smaller image.');
      return undefined;
    }
  }
  return image;
};

const moveImage = (list: string[], index: number, direction: 'left' | 'right') => {
  const next = [...list];
  const targetIndex = direction === 'left' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= next.length) return list;
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
};
interface LocationRequest {
  id: string;
  name: string;
  address: string;
  pictures?: Array<{ url: string; caption?: string }>;
  description?: string;
  most_known_for?: string;
  level_of_business?: 'high' | 'moderate' | 'low';
  requested_by: string;
  requested_by_name: string;
  requested_by_email: string;
  status: 'pending' | 'submitted' | 'approved' | 'denied';
  admin_notes?: string;
  created_at: string;
}

type ManagePageType =
  | 'menu'
  | 'location-requests'
  | 'manage-members'
  | 'manage-locations'
  | 'manage-announcements'
  | 'manage-events'
  | 'student-location-requests'
  | 'student-event-requests'
  | 'student-announcement-requests';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HEADER_SPACING = 16; // Consistent spacing constant

export default function RequestScreen() {
  const { user, isAuthenticated, logout, refreshUser } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<LocationRequest[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<LocationRequest | null>(null);
  const [currentPage, setCurrentPage] = useState<ManagePageType>('menu');
  const [statusMenuOpen, setStatusMenuOpen] = useState<string | null>(null);
  
  // Animation values for swipe transitions
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevPageRef = useRef<ManagePageType>('menu');
  const [locations, setLocations] = useState<any[]>([]);
  const [showLocationDetailModal, setShowLocationDetailModal] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<any | null>(null);
  
  // Form state for editing location details
  const [editLocationName, setEditLocationName] = useState('');
  const [editLocationAddress, setEditLocationAddress] = useState('');
  const [editLocationDescription, setEditLocationDescription] = useState('');
  const [editLocationTopQualities, setEditLocationTopQualities] = useState('');
  const [editLocationLevelOfBusiness, setEditLocationLevelOfBusiness] = useState<'high' | 'moderate' | 'low' | ''>('');
  const [editLocationSelectedImages, setEditLocationSelectedImages] = useState<string[]>([]);
  
  // Form state for creating new location
  const [showCreateLocationModal, setShowCreateLocationModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [newLocationDescription, setNewLocationDescription] = useState('');
  const [newLocationTopQualities, setNewLocationTopQualities] = useState('');
  const [newLocationLevelOfBusiness, setNewLocationLevelOfBusiness] = useState<'high' | 'moderate' | 'low' | ''>('');
  const [newLocationSelectedImages, setNewLocationSelectedImages] = useState<string[]>([]);
  
  // State for manage members
  const [members, setMembers] = useState<any[]>([]);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberProfilePic, setEditMemberProfilePic] = useState<string | null>(null);
  const [editMemberRole, setEditMemberRole] = useState<'admin' | 'student'>('student');
  const [showEditMemberRoleMenu, setShowEditMemberRoleMenu] = useState(false);
  const [memberRoleMenuOpen, setMemberRoleMenuOpen] = useState<string | null>(null);

  // State for manage announcements
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showCreateAnnouncementModal, setShowCreateAnnouncementModal] = useState(false);
  const [newAnnouncementTitle, setNewAnnouncementTitle] = useState('');
  const [newAnnouncementBody, setNewAnnouncementBody] = useState('');
  const [newAnnouncementImage, setNewAnnouncementImage] = useState<string | null>(null);
  const [showEditAnnouncementModal, setShowEditAnnouncementModal] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<any | null>(null);
  const [editAnnouncementTitle, setEditAnnouncementTitle] = useState('');
  const [editAnnouncementBody, setEditAnnouncementBody] = useState('');
  const [editAnnouncementImage, setEditAnnouncementImage] = useState<string | null>(null);

  // Announcement requests (students request; admin approves/denies)
  const [announcementRequests, setAnnouncementRequests] = useState<any[]>([]);
  const [showDenyAnnouncementRequestModal, setShowDenyAnnouncementRequestModal] = useState(false);
  const [selectedAnnouncementRequestToDeny, setSelectedAnnouncementRequestToDeny] = useState<any | null>(null);
  const [denyAnnouncementRequestNotes, setDenyAnnouncementRequestNotes] = useState('');
  const [announcementsFilter, setAnnouncementsFilter] = useState<'posted' | 'drafts' | 'request'>('posted');

  // Events (requests + posted)
  const [eventRequests, setEventRequests] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [eventsFilter, setEventsFilter] = useState<'posted' | 'requests'>('posted');
  const [showCreateEventModal, setShowCreateEventModal] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventLocation, setNewEventLocation] = useState('');
  const [newEventTopQualities, setNewEventTopQualities] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [newEventMeetingTime, setNewEventMeetingTime] = useState('');
  const [newEventImage, setNewEventImage] = useState<string | null>(null);
  const [selectedEventRequest, setSelectedEventRequest] = useState<any | null>(null);
  const [showEditEventRequestModal, setShowEditEventRequestModal] = useState(false);
  const [editEventName, setEditEventName] = useState('');
  const [editEventLocation, setEditEventLocation] = useState('');
  const [editEventTopQualities, setEditEventTopQualities] = useState('');
  const [editEventDescription, setEditEventDescription] = useState('');
  const [editEventMeetingTime, setEditEventMeetingTime] = useState('');
  const [editEventImage, setEditEventImage] = useState<string | null>(null);
  const [editEventAdminNotes, setEditEventAdminNotes] = useState('');
  const [selectedPostedEvent, setSelectedPostedEvent] = useState<any | null>(null);
  const [showEditPostedEventModal, setShowEditPostedEventModal] = useState(false);
  const [editPostedEventName, setEditPostedEventName] = useState('');
  const [editPostedEventLocation, setEditPostedEventLocation] = useState('');
  const [editPostedEventTopQualities, setEditPostedEventTopQualities] = useState('');
  const [editPostedEventDescription, setEditPostedEventDescription] = useState('');
  const [editPostedEventMeetingTime, setEditPostedEventMeetingTime] = useState('');
  const [editPostedEventImage, setEditPostedEventImage] = useState<string | null>(null);

  // Search (location requests, manage locations, manage members, announcements, events)
  const [locationRequestSearch, setLocationRequestSearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [announcementSearch, setAnnouncementSearch] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [showOrgSettingsModal, setShowOrgSettingsModal] = useState(false);
  const [orgNameForSettings, setOrgNameForSettings] = useState('');
  const [orgProfilePicForSettings, setOrgProfilePicForSettings] = useState<string | null>(null);
  
  // Refresh state
  const [refreshing, setRefreshing] = useState(false);

  // Form state for editing request details (admin)
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTopQualities, setEditTopQualities] = useState('');
  const [editLevelOfBusiness, setEditLevelOfBusiness] = useState<'high' | 'moderate' | 'low' | ''>('');
  const [editSelectedImage, setEditSelectedImage] = useState<string | null>(null);
  const [editAdminNotes, setEditAdminNotes] = useState('');

  // Form state for students
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [topQualities, setTopQualities] = useState('');
  const [levelOfBusiness, setLevelOfBusiness] = useState<'high' | 'moderate' | 'low' | ''>('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [studentAnnouncementTitle, setStudentAnnouncementTitle] = useState('');
  const [studentAnnouncementBody, setStudentAnnouncementBody] = useState('');
  const [studentAnnouncementImage, setStudentAnnouncementImage] = useState<string | null>(null);
  const [studentEventName, setStudentEventName] = useState('');
  const [studentEventLocation, setStudentEventLocation] = useState('');
  const [studentEventTopQualities, setStudentEventTopQualities] = useState('');
  const [studentEventDescription, setStudentEventDescription] = useState('');
  const [studentEventMeetingTime, setStudentEventMeetingTime] = useState('');
  const [studentEventImage, setStudentEventImage] = useState<string | null>(null);

  // For now, check if admin - this should come from AuthContext user object
  const userIsAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/login');
      return;
    }
    // Only load requests if authenticated
    if (isAuthenticated) {
      loadRequests();
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (currentPage === 'manage-members' && userIsAdmin) {
      loadMembers();
    }
  }, [currentPage, userIsAdmin]);

  useEffect(() => {
    if (currentPage === 'manage-announcements' && userIsAdmin) {
      loadAnnouncements();
      loadAnnouncementRequests();
    }
  }, [currentPage, userIsAdmin]);

  useEffect(() => {
    if (currentPage === 'manage-events' && userIsAdmin) {
      loadEvents();
      loadEventRequests();
    }
  }, [currentPage, userIsAdmin]);

  useEffect(() => {
    if (!userIsAdmin) {
      if (currentPage === 'student-location-requests') {
        loadRequests();
      } else if (currentPage === 'student-announcement-requests') {
        loadAnnouncementRequests();
      } else if (currentPage === 'student-event-requests') {
        loadEventRequests();
      }
    }
  }, [currentPage, userIsAdmin]);

  useEffect(() => {
    if (currentPage === 'menu' && userIsAdmin) {
      apiService.getMyOrg().then((d: { name?: string; org_profile_pic?: string | null }) => {
        setOrgNameForSettings(d.name || '');
        setOrgProfilePicForSettings(d.org_profile_pic || null);
      }).catch(() => {});
    }
  }, [currentPage, userIsAdmin]);

  // Handle page transitions with animation
  useEffect(() => {
    const pageOrder: ManagePageType[] = [
      'menu',
      'student-location-requests',
      'student-event-requests',
      'student-announcement-requests',
      'location-requests',
      'manage-locations',
      'manage-members',
      'manage-announcements',
      'manage-events',
    ];
    const currentIndex = pageOrder.indexOf(currentPage);
    const prevIndex = pageOrder.indexOf(prevPageRef.current);
    
    // If on menu page, ensure animation is at 0
    if (currentPage === 'menu') {
      slideAnim.setValue(0);
      prevPageRef.current = currentPage;
      return;
    }
    
    if (currentIndex !== prevIndex && prevIndex !== -1) {
      // Determine slide direction
      const slideValue = currentIndex > prevIndex ? SCREEN_WIDTH : -SCREEN_WIDTH;
      
      // Reset and animate
      slideAnim.setValue(slideValue);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
      
      prevPageRef.current = currentPage;
    } else if (prevIndex === -1) {
      // First render, set to 0
      slideAnim.setValue(0);
      prevPageRef.current = currentPage;
    }
  }, [currentPage]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await apiService.getLocationRequests();
      setRequests(Array.isArray(data) ? data : []);
    } catch (error: any) {
      // If token expired (401), logout and redirect to login
      if (error?.response?.status === 401) {
        // Token expired, logout and redirect to login
        await logout();
        router.replace('/(auth)/login');
        return;
      }
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const loadLocations = async () => {
    setLoading(true);
    try {
      const data = await apiService.getLocations({});
      setLocations(Array.isArray(data) ? data : []);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await logout();
        router.replace('/(auth)/login');
        return;
      }
      setLocations([]);
    } finally {
      setLoading(false);
    }
  };

  const openLocationDetail = (location: any) => {
    const normalizedPictures = Array.isArray(location.pictures)
      ? location.pictures
          .map((pic: any) => (typeof pic === 'string' ? pic : pic?.url))
          .filter((url: any) => typeof url === 'string' && url.length > 0)
      : [];
    setSelectedLocation(location);
    setEditLocationName(location.name || '');
    setEditLocationAddress(location.address || '');
    setEditLocationDescription(location.description || '');
    setEditLocationTopQualities(location.most_known_for || '');
    setEditLocationLevelOfBusiness(location.level_of_business || '');
    setEditLocationSelectedImages(normalizedPictures);
    setShowLocationDetailModal(true);
  };

  const pickEditLocationImages = async () => {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: 8,
        aspect: [4, 3],
        quality: 0.5,
      });

      if (!result.canceled && result.assets?.length) {
        const selectedUris = result.assets.map((asset) => asset.uri);
        setEditLocationSelectedImages((prev) => {
          const next = [...prev, ...selectedUris.filter((uri) => !prev.includes(uri))];
          return next.slice(0, 8);
        });
      }
    } catch (error) {
      console.warn('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
    }
  };

  const handleUpdateLocation = async () => {
    if (!selectedLocation) return;
    
    if (!editLocationName.trim() || !editLocationAddress.trim()) {
      Alert.alert('Error', 'Please fill in name and address');
      return;
    }
    if (countQualities(editLocationTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }

    setLoading(true);
    try {
      const pictures = buildPicturesFromUris(
        editLocationSelectedImages,
        editLocationTopQualities.trim() || undefined
      );

      await apiService.updateLocation(selectedLocation.id, {
        name: editLocationName.trim(),
        address: editLocationAddress.trim(),
        description: editLocationDescription.trim() || undefined,
        most_known_for: editLocationTopQualities || undefined,
        level_of_business: editLocationLevelOfBusiness || undefined,
        pictures,
      });
      Alert.alert('Success', 'Location updated successfully!');
      loadLocations();
      setShowLocationDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update location');
    } finally {
      setLoading(false);
    }
  };

  const pickNewLocationImages = async () => {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: 8,
        aspect: [4, 3],
        quality: 0.5,
      });

      if (!result.canceled && result.assets?.length) {
        const selectedUris = result.assets.map((asset) => asset.uri);
        setNewLocationSelectedImages((prev) => {
          const next = [...prev, ...selectedUris.filter((uri) => !prev.includes(uri))];
          return next.slice(0, 8);
        });
      }
    } catch (error) {
      console.warn('Image picker error:', error);
      Alert.alert('Error', 'Failed to pick images. Please try again.');
    }
  };

  const handleCreateLocation = async () => {
    if (!newLocationName.trim() || !newLocationAddress.trim()) {
      Alert.alert('Error', 'Please fill in name and address');
      return;
    }
    if (countQualities(newLocationTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }

    setLoading(true);
    try {
      const pictures = buildPicturesFromUris(
        newLocationSelectedImages,
        newLocationTopQualities.trim() || undefined
      );

      await apiService.createLocation({
        name: newLocationName.trim(),
        address: newLocationAddress.trim(),
        description: newLocationDescription.trim() || undefined,
        most_known_for: newLocationTopQualities || undefined,
        level_of_business: newLocationLevelOfBusiness || undefined,
        pictures,
      });
      
      Alert.alert('Success', 'Location created successfully!');
      setNewLocationName('');
      setNewLocationAddress('');
      setNewLocationDescription('');
      setNewLocationTopQualities('');
      setNewLocationLevelOfBusiness('');
      setNewLocationSelectedImages([]);
      setShowCreateLocationModal(false);
      loadLocations();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create location');
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async () => {
    setLoading(true);
    try {
      const data = await apiService.getUsers();
      setMembers(Array.isArray(data?.users) ? data.users : []);
    } catch (error: any) {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAnnouncements = async () => {
    setLoading(true);
    try {
      const data = await apiService.getAnnouncements();
      setAnnouncements(Array.isArray(data) ? data : []);
    } catch (error: any) {
      if (error?.response?.status === 401) {
        await logout();
        router.replace('/(auth)/login');
        return;
      }
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAnnouncementRequests = async () => {
    try {
      const data = await apiService.getAnnouncementRequests();
      setAnnouncementRequests(Array.isArray(data) ? data : []);
    } catch (error: any) {
      setAnnouncementRequests([]);
    }
  };

  const loadEventRequests = async () => {
    try {
      const data = await apiService.getEventRequests();
      setEventRequests(Array.isArray(data) ? data : []);
    } catch (error: any) {
      setEventRequests([]);
    }
  };

  const loadEvents = async () => {
    try {
      const data = await apiService.getEvents();
      setEvents(Array.isArray(data) ? data : []);
    } catch (error: any) {
      setEvents([]);
    }
  };

  const pickNewEventImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setNewEventImage(imageUri);
      }
    }
  };

  const handleCreateEvent = async () => {
    if (!newEventName.trim()) {
      Alert.alert('Error', 'Event name is required');
      return;
    }
    if (countQualities(newEventTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }
    setLoading(true);
    try {
      await apiService.createEvent({
        event_name: newEventName.trim(),
        location: newEventLocation.trim() || undefined,
        top_qualities: newEventTopQualities.trim() || undefined,
        description: newEventDescription.trim() || undefined,
        meeting_time: newEventMeetingTime.trim() || undefined,
        picture: newEventImage || undefined,
      });
      Alert.alert('Success', 'Event created');
      setNewEventName('');
      setNewEventLocation('');
      setNewEventTopQualities('');
      setNewEventDescription('');
      setNewEventMeetingTime('');
      setNewEventImage(null);
      setShowCreateEventModal(false);
      loadEvents();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to create event');
    } finally {
      setLoading(false);
    }
  };

  const openEventRequestDetail = (req: any) => {
    setSelectedEventRequest(req);
    setEditEventName(req.event_name || '');
    setEditEventLocation(req.location || '');
    setEditEventTopQualities(req.top_qualities || '');
    setEditEventDescription(req.description || '');
    setEditEventMeetingTime(req.meeting_time || '');
    setEditEventImage(req.picture || null);
    setEditEventAdminNotes(req.admin_notes || '');
    setShowEditEventRequestModal(true);
  };

  const pickEditEventRequestImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setEditEventImage(imageUri);
      }
    }
  };

  const handleSaveEventRequest = async () => {
    if (!selectedEventRequest) return;
    if (!editEventName.trim()) {
      Alert.alert('Error', 'Event name is required');
      return;
    }
    if (countQualities(editEventTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }
    setLoading(true);
    try {
      await apiService.updateEventRequest(selectedEventRequest.id, {
        event_name: editEventName.trim(),
        location: editEventLocation.trim() || undefined,
        top_qualities: editEventTopQualities.trim() || undefined,
        description: editEventDescription.trim() || undefined,
        meeting_time: editEventMeetingTime.trim() || undefined,
        picture: editEventImage || undefined,
        admin_notes: editEventAdminNotes.trim() || undefined,
      });
      Alert.alert('Success', 'Event request updated');
      loadEventRequests();
      setShowEditEventRequestModal(false);
      setSelectedEventRequest(null);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to update request');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveEventRequest = async (requestId: string) => {
    setLoading(true);
    try {
      await apiService.approveEventRequest(requestId);
      Alert.alert('Success', 'Event posted');
      loadEventRequests();
      loadEvents();
      setShowEditEventRequestModal(false);
      setSelectedEventRequest(null);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to approve request');
    } finally {
      setLoading(false);
    }
  };

  const handleDenyEventRequest = async (requestId: string) => {
    Alert.prompt(
      'Deny Event Request',
      'Please provide a reason for denial:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deny',
          onPress: async (reason: string | undefined) => {
            if (!reason || !reason.trim()) {
              Alert.alert('Error', 'Reason is required');
              return;
            }
            setLoading(true);
            try {
              await apiService.denyEventRequest(requestId, reason.trim());
              Alert.alert('Success', 'Event request denied');
              loadEventRequests();
              setShowEditEventRequestModal(false);
              setSelectedEventRequest(null);
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail || 'Failed to deny request');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
      'plain-text'
    );
  };

  const openPostedEventDetail = (evt: any) => {
    setSelectedPostedEvent(evt);
    setEditPostedEventName(evt.event_name || '');
    setEditPostedEventLocation(evt.location || '');
    setEditPostedEventTopQualities(evt.top_qualities || '');
    setEditPostedEventDescription(evt.description || '');
    setEditPostedEventMeetingTime(evt.meeting_time || '');
    setEditPostedEventImage(evt.picture || null);
    setShowEditPostedEventModal(true);
  };

  const pickEditPostedEventImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setEditPostedEventImage(imageUri);
      }
    }
  };

  const handleUpdatePostedEvent = async () => {
    if (!selectedPostedEvent) return;
    if (!editPostedEventName.trim()) {
      Alert.alert('Error', 'Event name is required');
      return;
    }
    if (countQualities(editPostedEventTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }
    setLoading(true);
    try {
      await apiService.patchEvent(selectedPostedEvent.id, {
        event_name: editPostedEventName.trim(),
        location: editPostedEventLocation.trim() || undefined,
        top_qualities: editPostedEventTopQualities.trim() || undefined,
        description: editPostedEventDescription.trim() || undefined,
        meeting_time: editPostedEventMeetingTime.trim() || undefined,
        picture: editPostedEventImage || undefined,
      });
      Alert.alert('Success', 'Event updated');
      loadEvents();
      setShowEditPostedEventModal(false);
      setSelectedPostedEvent(null);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to update event');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStudent = async (email: string, name: string) => {
    Alert.alert(
      'Delete Student',
      `Are you sure you want to delete ${name}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await apiService.deleteStudent(email);
              Alert.alert('Success', 'Student deleted successfully');
              loadMembers();
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to delete student');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteMember = async (memberId: string, name: string, email: string) => {
    Alert.alert(
      'Delete Member',
      `Are you sure you want to delete ${name} (${email})? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await apiService.deleteUser(memberId);
              Alert.alert('Success', 'Member deleted successfully');
              loadMembers();
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to delete member');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleChangeMemberRole = async (memberId: string, newRole: 'admin' | 'student') => {
    setMemberRoleMenuOpen(null);
    setLoading(true);
    try {
      await apiService.updateUserRole(memberId, newRole);
      Alert.alert('Success', `Member role changed to ${newRole}`);
      loadMembers();
    } catch (error: any) {
      const msg = (typeof error?.response?.data?.detail === 'string')
        ? error.response.data.detail
        : (error?.response?.data?.detail?.message ?? error?.response?.data?.message) || 'Failed to update member role';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const openEditMemberModal = (member: any) => {
    setSelectedMember(member);
    setEditMemberName(member.name || '');
    setEditMemberProfilePic(member.profile_pic || null);
    setEditMemberRole(member.role || 'student');
    setShowEditMemberRoleMenu(false);
    setShowEditMemberModal(true);
  };

  const pickEditMemberImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setEditMemberProfilePic(imageUri);
      }
    }
  };

  const pickNewAnnouncementImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setNewAnnouncementImage(imageUri);
      }
    }
  };

  const pickEditAnnouncementImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setEditAnnouncementImage(imageUri);
      }
    }
  };

  const pickImageForOrgSettings = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setOrgProfilePicForSettings(imageUri);
      }
    }
  };

  const handleUpdateMember = async () => {
    if (!selectedMember) return;
    
    if (!editMemberName.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      await apiService.updateUserProfile(selectedMember.id, {
        name: editMemberName.trim(),
        profile_pic: editMemberProfilePic || undefined,
      });

      if (editMemberRole && editMemberRole !== selectedMember.role) {
        await apiService.updateUserRole(selectedMember.id, editMemberRole);
      }
      
      Alert.alert('Success', 'Member profile updated successfully!');
      loadMembers();
      
      // If editing self, refresh user context
      if (selectedMember.id === user?.user_id) {
        await refreshUser();
      }
      
      setShowEditMemberModal(false);
    } catch (error: any) {
      const msg = (typeof error?.response?.data?.detail === 'string')
        ? error.response.data.detail
        : (error?.response?.data?.detail?.message ?? error?.response?.data?.message) || 'Failed to update member profile';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async () => {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }

    // Launch image picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setSelectedImage(imageUri);
      }
    }
  };

  const pickStudentAnnouncementImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setStudentAnnouncementImage(imageUri);
      }
    }
  };

  const pickStudentEventImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setStudentEventImage(imageUri);
      }
    }
  };

  const handleSubmitRequest = async () => {
    if (!name.trim() || !address.trim()) {
      Alert.alert('Error', 'Please fill in name and address');
      return;
    }
    if (countQualities(topQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }

    setLoading(true);
    try {
      // Convert image to base64 if an image was selected
      const pictures = selectedImage ? [{ url: selectedImage, caption: topQualities || description }] : undefined;

      await apiService.createLocationRequest({
        name: name.trim(),
        address: address.trim(),
        description: description.trim() || undefined,
        most_known_for: topQualities.trim() || undefined,
        level_of_business: levelOfBusiness || undefined,
        pictures,
      });
      Alert.alert('Success', 'Request submitted successfully! An admin will review it.', [
        { text: 'OK', onPress: () => {
          setName('');
          setAddress('');
          setDescription('');
          setTopQualities('');
          setLevelOfBusiness('');
          setSelectedImage(null);
          loadRequests();
        }},
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnnouncementRequest = async () => {
    if (!studentAnnouncementTitle.trim() || !studentAnnouncementBody.trim()) {
      Alert.alert('Error', 'Please fill in title and body');
      return;
    }
    setLoading(true);
    try {
      const image = getSafeUploadImage(studentAnnouncementImage);
      await apiService.createAnnouncementRequest({
        title: studentAnnouncementTitle.trim(),
        body: studentAnnouncementBody.trim(),
        image,
      });
      Alert.alert('Submitted', 'Your announcement request was sent.');
      setStudentAnnouncementTitle('');
      setStudentAnnouncementBody('');
      setStudentAnnouncementImage(null);
      loadAnnouncementRequests();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitEventRequest = async () => {
    if (!studentEventName.trim()) {
      Alert.alert('Error', 'Event name is required');
      return;
    }
    if (countQualities(studentEventTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }
    setLoading(true);
    try {
      await apiService.createEventRequest({
        event_name: studentEventName.trim(),
        location: studentEventLocation.trim() || undefined,
        top_qualities: studentEventTopQualities.trim() || undefined,
        description: studentEventDescription.trim() || undefined,
        meeting_time: studentEventMeetingTime.trim() || undefined,
        picture: studentEventImage || undefined,
      });
      Alert.alert('Submitted', 'Your event request was sent.');
      setStudentEventName('');
      setStudentEventLocation('');
      setStudentEventTopQualities('');
      setStudentEventDescription('');
      setStudentEventMeetingTime('');
      setStudentEventImage(null);
      loadEventRequests();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setStatusMenuOpen(null);
    setLoading(true);
    try {
      await apiService.approveLocationRequest(requestId);
      Alert.alert('Success', 'Request approved! It is now in Manage Locations (Posted).');
      loadRequests();
      loadLocations();
      if (selectedRequest?.id === requestId) {
        setShowDetailModal(false);
        setSelectedRequest(null);
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to approve request');
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async (requestId: string) => {
    Alert.prompt(
      'Deny Request',
      'Please provide a reason for denial:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deny',
          onPress: async (reason: string | undefined) => {
            if (!reason || !reason.trim()) {
              Alert.alert('Error', 'Reason is required');
              return;
            }
            setLoading(true);
            try {
              await apiService.denyLocationRequest(requestId, reason.trim());
              Alert.alert('Success', 'Request denied');
              loadRequests();
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to deny request');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
      'plain-text'
    );
  };

  // Refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (currentPage === 'location-requests') {
        await loadRequests();
      } else if (currentPage === 'manage-locations') {
        await loadLocations();
      } else if (currentPage === 'manage-members') {
        await loadMembers();
      } else if (currentPage === 'manage-announcements') {
        await loadAnnouncements();
        await loadAnnouncementRequests();
      } else if (currentPage === 'manage-events') {
        await loadEvents();
        await loadEventRequests();
      } else if (currentPage === 'student-location-requests') {
        await loadRequests();
      } else if (currentPage === 'student-announcement-requests') {
        await loadAnnouncementRequests();
      } else if (currentPage === 'student-event-requests') {
        await loadEventRequests();
      }
    } finally {
      setRefreshing(false);
    }
  };

  // Swipe gesture handler for going back
  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal swipes when not on menu page
        return currentPage !== 'menu' && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 10;
      },
      onPanResponderRelease: (_, gestureState) => {
        // Swipe right to go back (like Instagram)
        if (gestureState.dx > 100 && currentPage !== 'menu') {
          setCurrentPage('menu');
        }
      },
    }),
    [currentPage]
  );

  // Only show global loading when we're not on manage-members or manage-locations.
  // Those pages set loading via loadMembers/loadLocations and have their own empty/loading UI.
  // Without this, tapping Manage Members would trigger loadMembers -> setLoading(true), and
  // we'd return this spinner instead of the manage-members page (when requests.length === 0).
  if (
    loading &&
    requests.length === 0 &&
    currentPage !== 'manage-members' &&
    currentPage !== 'manage-locations' &&
    currentPage !== 'manage-announcements'
  ) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#5FA8D3" />
        </View>
      </ThemedView>
    );
  }

  // Render management menu for admin
  const renderManagementMenu = () => {
    return (
      <ScrollView
        contentContainerStyle={[
          styles.menuContent,
          styles.menuContentWithPadding,
          { paddingBottom: insets.bottom + 20 },
        ]}
        showsVerticalScrollIndicator={false}>
          {userIsAdmin && (
          <View style={styles.menuItem}>
            <TouchableOpacity
              style={styles.menuItemButton}
              onPress={() => setShowOrgSettingsModal(true)}
              activeOpacity={0.7}>
              <ThemedText style={styles.menuItemTitle}>Organization settings</ThemedText>
              <ThemedText style={styles.menuItemArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>
          )}
          <View style={styles.menuItem}>
            <TouchableOpacity
              style={styles.menuItemButton}
              onPress={() => {
                setCurrentPage('location-requests');
                loadRequests();
              }}
              activeOpacity={0.7}>
              <ThemedText style={styles.menuItemTitle}>Location Requests</ThemedText>
              <ThemedText style={styles.menuItemArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>
          <View style={styles.menuItem}>
            <TouchableOpacity
              style={styles.menuItemButton}
              onPress={() => {
                setCurrentPage('manage-locations');
                loadLocations();
              }}
              activeOpacity={0.7}>
              <ThemedText style={styles.menuItemTitle}>Existing Locations</ThemedText>
              <ThemedText style={styles.menuItemArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>
          <View style={styles.menuItem}>
            <TouchableOpacity
              style={styles.menuItemButton}
              onPress={() => setCurrentPage('manage-members')}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <ThemedText style={styles.menuItemTitle}>Members</ThemedText>
              <ThemedText style={styles.menuItemArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>
          <View style={styles.menuItem}>
            <TouchableOpacity
              style={styles.menuItemButton}
              onPress={() => {
                setCurrentPage('manage-announcements');
                loadAnnouncements();
              }}
              activeOpacity={0.7}>
              <ThemedText style={styles.menuItemTitle}>Announcements</ThemedText>
              <ThemedText style={styles.menuItemArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>
          <View style={styles.menuItem}>
            <TouchableOpacity
              style={styles.menuItemButton}
              onPress={() => {
                setCurrentPage('manage-events');
                loadEvents();
                loadEventRequests();
              }}
              activeOpacity={0.7}>
              <ThemedText style={styles.menuItemTitle}>Events</ThemedText>
              <ThemedText style={styles.menuItemArrow}>›</ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
    );
  };

  // Render back button and header for sub-pages
  const renderPageHeader = (title: string, rightButton?: React.ReactNode) => {
    return (
      <View style={[styles.pageHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
        <TouchableOpacity
          onPress={() => setCurrentPage('menu')}
          style={styles.backButtonContainer}>
          <ThemedText style={styles.pageBackButton}>←</ThemedText>
        </TouchableOpacity>
        <ThemedText style={styles.pageHeaderTitle}>{title}</ThemedText>
        {rightButton || <View style={{ width: 40 }} />}
      </View>
    );
  };

  const parseQualities = (text?: string): string[] => {
    if (!text) return [];
    return text
      .split(/[,;\n]/)
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 10);
  };

  const renderQualitiesPills = (text?: string) => {
    const items = parseQualities(text);
    if (items.length === 0) return null;
    return (
      <View style={styles.pillRow}>
        {items.map((q, i) => (
          <View key={`${q}-${i}`} style={styles.pill}>
            <ThemedText style={styles.pillText}>{q}</ThemedText>
          </View>
        ))}
      </View>
    );
  };

  const handleDeleteRequest = async (requestId: string) => {
    Alert.alert(
      'Delete Request',
      'Are you sure you want to delete this request?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.deleteLocationRequest(requestId);
              Alert.alert('Success', 'Request deleted');
              loadRequests();
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to delete request');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAnnouncementRequest = (requestId: string) => {
    Alert.alert('Delete Request', 'Are you sure you want to delete this request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiService.deleteAnnouncementRequest(requestId);
            loadAnnouncementRequests();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail || 'Failed to delete request');
          }
        },
      },
    ]);
  };

  const handleDeleteEventRequest = (requestId: string) => {
    Alert.alert('Delete Request', 'Are you sure you want to delete this request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiService.deleteEventRequest(requestId);
            loadEventRequests();
          } catch (e: any) {
            Alert.alert('Error', e?.response?.data?.detail || 'Failed to delete request');
          }
        },
      },
    ]);
  };

  const handleStatusChange = async (requestId: string, newStatus: 'pending' | 'submitted' | 'approved' | 'denied') => {
    setStatusMenuOpen(null);
    setLoading(true);
    try {
      await apiService.updateRequestStatus(requestId, newStatus);
      Alert.alert('Success', `Request status changed to ${newStatus}`);
      loadRequests();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const openRequestDetail = (request: LocationRequest) => {
    setSelectedRequest(request);
    // Populate edit form with request data
    setEditName(request.name);
    setEditAddress(request.address);
    setEditDescription(request.description || '');
    setEditTopQualities(request.most_known_for || '');
    setEditLevelOfBusiness(request.level_of_business || '');
    setEditSelectedImage(request.pictures?.[0]?.url || null);
    setEditAdminNotes(request.admin_notes || '');
    setShowDetailModal(true);
  };

  const pickEditImage = async () => {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }

    // Launch image picker
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setEditSelectedImage(imageUri);
      }
    }
  };

  const handleUpdateRequest = async () => {
    if (!selectedRequest) return;
    
    if (!editName.trim() || !editAddress.trim()) {
      Alert.alert('Error', 'Please fill in name and address');
      return;
    }
    if (countQualities(editTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }

    setLoading(true);
    try {
      const pictures = editSelectedImage ? [{ url: editSelectedImage, caption: editDescription }] : undefined;

      await apiService.updateLocationRequest(selectedRequest.id, {
        name: editName.trim(),
        address: editAddress.trim(),
        description: editDescription.trim() || undefined,
        most_known_for: editTopQualities || undefined,
        level_of_business: editLevelOfBusiness || undefined,
        pictures,
        admin_notes: editAdminNotes || undefined,
      });
      Alert.alert('Success', 'Request updated successfully!');
      loadRequests();
      setShowDetailModal(false);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update request');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRequestAsLocation = async () => {
    if (!selectedRequest) return;
    
    if (!editName.trim() || !editAddress.trim()) {
      Alert.alert('Error', 'Please fill in name and address');
      return;
    }
    if (countQualities(editTopQualities) > MAX_QUALITIES) {
      Alert.alert('Error', `Top qualities can have at most ${MAX_QUALITIES} items.`);
      return;
    }

    setLoading(true);
    try {
      const pictures = editSelectedImage ? [{ url: editSelectedImage, caption: editTopQualities }] : undefined;

      // Create location from request
      await apiService.createLocation({
        name: editName.trim(),
        address: editAddress.trim(),
        description: editDescription.trim() || undefined,
        most_known_for: editTopQualities || undefined,
        level_of_business: editLevelOfBusiness || undefined,
        pictures,
      });
      
      // Delete the request after successful location creation
      await apiService.deleteLocationRequest(selectedRequest.id);
      
      Alert.alert('Success', 'Location created and posted. It is now in Manage Locations (Posted).', [
        { text: 'OK', onPress: () => {
          loadRequests();
          loadLocations();
          setShowDetailModal(false);
          setSelectedRequest(null);
        }},
      ]);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create location');
    } finally {
      setLoading(false);
    }
  };

  // Student view - menu + request pages
  if (!userIsAdmin) {
    if (currentPage === 'menu') {
      return (
        <ThemedView style={styles.container}>
          <View style={[styles.headerContainer, { paddingTop: insets.top + HEADER_SPACING }]}>
            <ThemedText type="title" style={styles.headerTitle}>Requests</ThemedText>
            <ThemedText style={styles.headerSubtitle}>
              Submit a new request or view your existing requests
            </ThemedText>
          </View>
          <ScrollView
            contentContainerStyle={[
              styles.menuContent,
              styles.menuContentWithPadding,
              { paddingBottom: insets.bottom + 20 },
            ]}
            showsVerticalScrollIndicator={false}>
            <View style={styles.menuItem}>
              <TouchableOpacity
                style={styles.menuItemButton}
                onPress={() => {
                  setCurrentPage('student-location-requests');
                  loadRequests();
                }}
                activeOpacity={0.7}>
                <ThemedText style={styles.menuItemTitle}>Location Requests</ThemedText>
                <ThemedText style={styles.menuItemArrow}>›</ThemedText>
              </TouchableOpacity>
            </View>
            <View style={styles.menuItem}>
              <TouchableOpacity
                style={styles.menuItemButton}
                onPress={() => {
                  setCurrentPage('student-event-requests');
                  loadEventRequests();
                }}
                activeOpacity={0.7}>
                <ThemedText style={styles.menuItemTitle}>Event Requests</ThemedText>
                <ThemedText style={styles.menuItemArrow}>›</ThemedText>
              </TouchableOpacity>
            </View>
            <View style={styles.menuItem}>
              <TouchableOpacity
                style={styles.menuItemButton}
                onPress={() => {
                  setCurrentPage('student-announcement-requests');
                  loadAnnouncementRequests();
                }}
                activeOpacity={0.7}>
                <ThemedText style={styles.menuItemTitle}>Announcement Requests</ThemedText>
                <ThemedText style={styles.menuItemArrow}>›</ThemedText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </ThemedView>
      );
    }

    if (currentPage === 'student-location-requests') {
      return (
        <ThemedView style={styles.container} {...panResponder.panHandlers}>
          {renderPageHeader('Location Requests')}
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Location Name *</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Library Coffee Shop"
                  placeholderTextColor="#888888"
                  value={name}
                  onChangeText={setName}
                  maxLength={MAX_ANNOUNCEMENT_TITLE_LEN}
                  returnKeyType="next"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  blurOnSubmit={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Address *</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Full address"
                  placeholderTextColor="#888888"
                  value={address}
                  onChangeText={setAddress}
                  multiline
                  returnKeyType="next"
                  blurOnSubmit={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Description (optional)</ThemedText>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Short description of this location"
                  placeholderTextColor="#888888"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  returnKeyType="next"
                  blurOnSubmit={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Top Qualities</ThemedText>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter top qualities separated by commas (e.g., Coffee, WiFi, Quiet)"
                  placeholderTextColor="#888888"
                  value={topQualities}
                  onChangeText={setTopQualities}
                  multiline
                  numberOfLines={3}
                  returnKeyType="next"
                  blurOnSubmit={false}
                />
                <ThemedText style={styles.hintText}>
                  Use commas to create bubbles (e.g., Coffee, WiFi, Quiet).
                </ThemedText>
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Level of Business</ThemedText>
                <View style={styles.buttonRow}>
                  {(['high', 'moderate', 'low'] as const).map((level) => (
                    <TouchableOpacity
                      key={level}
                      style={[
                        styles.levelButton,
                        levelOfBusiness === level && styles.levelButtonActive,
                      ]}
                      onPress={() => setLevelOfBusiness(level)}>
                      <ThemedText
                        style={[
                          styles.levelButtonText,
                          levelOfBusiness === level && styles.levelButtonTextActive,
                        ]}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Image (optional)</ThemedText>
                {selectedImage ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: selectedImage }} style={styles.imagePreview} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => setSelectedImage(null)}>
                      <ThemedText style={styles.removeImageButtonText}>Remove Image</ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.imagePickerButton}
                    onPress={pickImage}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.imagePickerButtonText}>Choose from Camera Roll</ThemedText>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handleSubmitRequest}
                disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.submitButtonText}>Submit Request</ThemedText>
                )}
              </TouchableOpacity>
            </View>

            {requests.length > 0 && (
              <View style={styles.myRequestsSection}>
                <ThemedText style={styles.sectionTitle}>My Requests</ThemedText>
                {requests.map((request, index) => (
                  <View key={`${request.id || 'request'}-${index}`} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <ThemedText style={styles.requestName}>{request.name}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View
                          style={[
                            styles.statusBadge,
                            request.status === 'submitted' && styles.statusSubmitted,
                            request.status === 'approved' && styles.statusApproved,
                            request.status === 'denied' && styles.statusDenied,
                          ]}>
                          <ThemedText style={styles.statusText}>{request.status}</ThemedText>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteRequest(request.id)}
                          activeOpacity={0.7}>
                          <IconSymbol name="trash.fill" size={18} color="#FF6B6B" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <ThemedText style={styles.requestAddress}>{request.address}</ThemedText>
                    {request.description ? (
                      <ThemedText style={styles.requestDescription}>{request.description}</ThemedText>
                    ) : null}
                    {renderQualitiesPills(request.most_known_for)}
                    {request.level_of_business && (
                      <ThemedText style={styles.requestLevel}>
                        Business Level: {request.level_of_business}
                      </ThemedText>
                    )}
                    {request.admin_notes && (
                      <ThemedText style={styles.adminNotes}>Notes: {request.admin_notes}</ThemedText>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </ThemedView>
      );
    }

    if (currentPage === 'student-event-requests') {
      return (
        <ThemedView style={styles.container} {...panResponder.panHandlers}>
          {renderPageHeader('Event Requests')}
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Event name *</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Event name"
                  placeholderTextColor="#888888"
                  value={studentEventName}
                  onChangeText={setStudentEventName}
                  maxLength={MAX_EVENT_NAME_LEN}
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Location</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Where is it?"
                  placeholderTextColor="#888888"
                  value={studentEventLocation}
                  onChangeText={setStudentEventLocation}
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Meeting time</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Fri 6pm, Room 101"
                  placeholderTextColor="#888888"
                  value={studentEventMeetingTime}
                  onChangeText={setStudentEventMeetingTime}
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Description</ThemedText>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Describe the event"
                  placeholderTextColor="#888888"
                  value={studentEventDescription}
                  onChangeText={setStudentEventDescription}
                  multiline
                  numberOfLines={4}
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Top qualities</ThemedText>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Food, Networking, Live music"
                  placeholderTextColor="#888888"
                  value={studentEventTopQualities}
                  onChangeText={setStudentEventTopQualities}
                  multiline
                  numberOfLines={3}
                />
                <ThemedText style={styles.hintText}>
                  Use commas to create bubbles (e.g., Food, Networking, Live music).
                </ThemedText>
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Image (optional)</ThemedText>
                {studentEventImage ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: studentEventImage }} style={styles.imagePreview} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => setStudentEventImage(null)}>
                      <ThemedText style={styles.removeImageButtonText}>Remove Image</ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.imagePickerButton}
                    onPress={pickStudentEventImage}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.imagePickerButtonText}>Choose from Camera Roll</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handleSubmitEventRequest}
                disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.submitButtonText}>Submit Request</ThemedText>
                )}
              </TouchableOpacity>
            </View>

            {eventRequests.length > 0 && (
              <View style={styles.myRequestsSection}>
                <ThemedText style={styles.sectionTitle}>My Requests</ThemedText>
                {eventRequests.map((er, index) => (
                  <View key={`${er.id || 'event-request'}-${index}`} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <ThemedText style={styles.requestName}>{er.event_name}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View
                          style={[
                            styles.statusBadge,
                            er.status === 'pending' && styles.statusSubmitted,
                            er.status === 'approved' && styles.statusApproved,
                            er.status === 'denied' && styles.statusDenied,
                          ]}>
                          <ThemedText style={styles.statusText}>{er.status}</ThemedText>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteEventRequest(er.id)}
                          activeOpacity={0.7}>
                          <IconSymbol name="trash.fill" size={18} color="#FF6B6B" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {er.meeting_time ? (
                      <ThemedText style={styles.requestBy}>Meeting time: {er.meeting_time}</ThemedText>
                    ) : null}
                    {er.location ? (
                      <ThemedText style={styles.requestBy}>Location: {er.location}</ThemedText>
                    ) : null}
                    {er.description ? (
                      <ThemedText style={styles.requestDescription}>{er.description}</ThemedText>
                    ) : null}
                    {renderQualitiesPills(er.top_qualities)}
                    {er.admin_notes ? (
                      <ThemedText style={styles.adminNotes}>Notes: {er.admin_notes}</ThemedText>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </ThemedView>
      );
    }

    if (currentPage === 'student-announcement-requests') {
      return (
        <ThemedView style={styles.container} {...panResponder.panHandlers}>
          {renderPageHeader('Announcement Requests')}
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Title *</ThemedText>
                <TextInput
                  style={styles.input}
                  placeholder="Announcement title"
                  placeholderTextColor="#888888"
                  value={studentAnnouncementTitle}
                  onChangeText={setStudentAnnouncementTitle}
                  maxLength={MAX_ANNOUNCEMENT_TITLE_LEN}
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Body *</ThemedText>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="What would you like to announce?"
                  placeholderTextColor="#888888"
                  value={studentAnnouncementBody}
                  onChangeText={setStudentAnnouncementBody}
                  multiline
                  numberOfLines={4}
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.label}>Image (optional)</ThemedText>
                {studentAnnouncementImage ? (
                  <View style={styles.imagePreviewContainer}>
                    <Image source={{ uri: studentAnnouncementImage }} style={styles.imagePreview} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => setStudentAnnouncementImage(null)}>
                      <ThemedText style={styles.removeImageButtonText}>Remove Image</ThemedText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.imagePickerButton}
                    onPress={pickStudentAnnouncementImage}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.imagePickerButtonText}>Choose from Camera Roll</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handleSubmitAnnouncementRequest}
                disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.submitButtonText}>Submit Request</ThemedText>
                )}
              </TouchableOpacity>
            </View>

            {announcementRequests.length > 0 && (
              <View style={styles.myRequestsSection}>
                <ThemedText style={styles.sectionTitle}>My Requests</ThemedText>
                {announcementRequests.map((ar, index) => (
                  <View key={`${ar.id || 'announcement-request'}-${index}`} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <ThemedText style={styles.requestName}>{ar.title}</ThemedText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View
                          style={[
                            styles.statusBadge,
                            ar.status === 'pending' && styles.statusSubmitted,
                            ar.status === 'approved' && styles.statusApproved,
                            ar.status === 'denied' && styles.statusDenied,
                          ]}>
                          <ThemedText style={styles.statusText}>{ar.status}</ThemedText>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteAnnouncementRequest(ar.id)}
                          activeOpacity={0.7}>
                          <IconSymbol name="trash.fill" size={18} color="#FF6B6B" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <ThemedText style={styles.requestDescription}>{ar.body}</ThemedText>
                    {ar.admin_notes ? (
                      <ThemedText style={styles.adminNotes}>Notes: {ar.admin_notes}</ThemedText>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </ThemedView>
      );
    }
  }

  // Admin view - show menu or specific page
  if (currentPage === 'menu') {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.headerContainer, { paddingTop: insets.top + HEADER_SPACING }]}>
          <ThemedText type="title" style={styles.headerTitle}>Manage This Organization</ThemedText>
        </View>
        {renderManagementMenu()}
        <Modal
          visible={showOrgSettingsModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowOrgSettingsModal(false)}>
          <View style={styles.detailModalContainer}>
            <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
              <TouchableOpacity onPress={() => setShowOrgSettingsModal(false)}>
                <ThemedText style={styles.backButton}>←</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.detailHeaderTitle}>Organization settings</ThemedText>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView
              style={styles.detailScrollView}
              contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 40 }]}
              keyboardShouldPersistTaps="handled">
              <View style={styles.detailEditForm}>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Organization profile picture</ThemedText>
                  <View style={styles.profilePicContainer}>
                    {orgProfilePicForSettings ? (
                      <Image source={{ uri: orgProfilePicForSettings }} style={styles.profilePicPreview} resizeMode="cover" />
                    ) : (
                      <View style={[styles.profilePicPreview, styles.profilePicPlaceholder]}>
                        <ThemedText style={styles.profilePicPlaceholderText}>?</ThemedText>
                      </View>
                    )}


                   

                    <View style={styles.orgImageButtonRow}>
                      <TouchableOpacity
                        style={[styles.orgImageButton, styles.orgChangeButton]}
                        onPress={pickImageForOrgSettings}
                        activeOpacity={0.8}
                      >
                        <ThemedText style={styles.orgImageButtonText}>Change Image</ThemedText>
                      </TouchableOpacity>

                      {orgProfilePicForSettings ? (
                        <TouchableOpacity
                          style={[styles.orgImageButton, styles.orgRemoveButton]}
                          onPress={() => setOrgProfilePicForSettings(null)}
                          activeOpacity={0.8}
                        >
                          <ThemedText style={styles.orgRemoveButtonText}>Remove</ThemedText>
                        </TouchableOpacity>
                      ) : null}
                    </View>





                    
                  </View>
                </View>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Organization name</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="Organization name"
                    placeholderTextColor="#888888"
                    value={orgNameForSettings}
                    onChangeText={setOrgNameForSettings}
                  />
                </View>
                <TouchableOpacity
                  style={[styles.submitButton, (loading || !orgNameForSettings.trim()) && styles.submitButtonDisabled]}
                  disabled={loading || !orgNameForSettings.trim()}
                  onPress={async () => {
                    setLoading(true);
                    try {
                      await apiService.updateOrgName(orgNameForSettings.trim());
                      await apiService.updateOrgProfilePic(orgProfilePicForSettings);
                      Alert.alert('Success', 'Organization updated');
                      setShowOrgSettingsModal(false);
                    } catch (e: any) {
                      Alert.alert('Error', e?.response?.data?.detail || 'Failed to update');
                    } finally {
                      setLoading(false);
                    }
                  }}>
                  <ThemedText style={styles.submitButtonText}>Save</ThemedText>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </Modal>
      </ThemedView>
    );
  }

  if (currentPage === 'location-requests') {
    return (
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.pageContainer,
            {
              transform: [{ translateX: slideAnim }],
            },
          ]}>
          {renderPageHeader('Location Requests')}
          <View style={styles.searchBarWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or address..."
              placeholderTextColor="#888888"
              value={locationRequestSearch}
              onChangeText={setLocationRequestSearch}
            />
          </View>
          <TouchableWithoutFeedback onPress={() => setStatusMenuOpen(null)}>
            <ScrollView
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 20 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }>
        {(locationRequestSearch.trim() ? requests.filter((r) => {
          const q = locationRequestSearch.trim().toLowerCase();
          return (r.name || '').toLowerCase().includes(q) || (r.address || '').toLowerCase().includes(q);
        }) : requests).map((request, index) => (
          <TouchableOpacity
            key={`${request.id || 'location-request'}-${index}`}
            style={styles.requestCard}
            onPress={() => openRequestDetail(request)}
            activeOpacity={0.9}>
            <View style={styles.requestHeader}>
              <ThemedText style={styles.requestName}>{request.name}</ThemedText>
              <View style={styles.headerRightContainer}>
                {userIsAdmin ? (
                  <View style={styles.statusContainer}>
                    <TouchableOpacity
                      style={[
                        styles.statusBadge,
                        request.status === 'submitted' && styles.statusSubmitted,
                        request.status === 'approved' && styles.statusApproved,
                        request.status === 'denied' && styles.statusDenied,
                      ]}
                      onPress={(e) => {
                        e.stopPropagation();
                        // Don't allow status change if request is submitted (only admins can change from submitted)
                        setStatusMenuOpen(statusMenuOpen === request.id ? null : request.id);
                      }}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.statusText}>{request.status}</ThemedText>
                    </TouchableOpacity>
                    {statusMenuOpen === request.id && (
                      <View style={styles.statusMenu}>
                        <TouchableOpacity
                          style={[styles.statusMenuItem, request.status === 'pending' && styles.statusMenuItemActive]}
                          onPress={() => handleStatusChange(request.id, 'pending')}>
                          <ThemedText style={styles.statusMenuItemText}>Pending</ThemedText>
                        </TouchableOpacity>
                        {request.status !== 'denied' && (
                        <TouchableOpacity
                          style={[styles.statusMenuItem, request.status === 'approved' && styles.statusMenuItemActive]}
                          onPress={() => handleApprove(request.id)}>
                          <ThemedText style={styles.statusMenuItemText}>Approve (post to Locations)</ThemedText>
                        </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[styles.statusMenuItem, request.status === 'denied' && styles.statusMenuItemActive]}
                          onPress={() => handleStatusChange(request.id, 'denied')}>
                          <ThemedText style={styles.statusMenuItemText}>Denied</ThemedText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ) : (
                  <View
                    style={[
                      styles.statusBadge,
                      request.status === 'approved' && styles.statusApproved,
                      request.status === 'denied' && styles.statusDenied,
                    ]}>
                    <ThemedText style={styles.statusText}>{request.status}</ThemedText>
                  </View>
                )}
                {userIsAdmin && (
                  <TouchableOpacity
                    style={styles.deleteIconButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDeleteRequest(request.id);
                    }}
                    activeOpacity={0.7}>
                    <IconSymbol name="trash.fill" size={20} color="#FF6B6B" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ThemedText style={styles.requestAddress}>{request.address}</ThemedText>

            {request.most_known_for && (
              <ThemedText style={styles.requestDescription}>{request.most_known_for}</ThemedText>
            )}

            {request.level_of_business && (
              <ThemedText style={styles.requestLevel}>
                Business Level: {request.level_of_business}
              </ThemedText>
            )}

            <ThemedText style={styles.requestBy}>
              Requested by: {request.requested_by_name} ({request.requested_by_email})
            </ThemedText>

            {request.admin_notes && (
              <ThemedText style={styles.adminNotes}>Notes: {request.admin_notes}</ThemedText>
            )}
          </TouchableOpacity>
        ))}

        {requests.length === 0 && (
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>No requests found</ThemedText>
          </View>
        )}
          </ScrollView>
        </TouchableWithoutFeedback>

          {/* Instagram-style Request Detail Modal for Admin */}
          <Modal
            visible={showDetailModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowDetailModal(false)}>
            {selectedRequest && (
              <View style={styles.detailModalContainer}>
                <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                  <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                    <ThemedText style={styles.backButton}>←</ThemedText>
                  </TouchableOpacity>
                  <ThemedText style={styles.detailHeaderTitle}>Request Details</ThemedText>
                  <View style={{ width: 40 }} />
                </View>

            <ScrollView
              style={styles.detailScrollView}
              contentContainerStyle={styles.detailContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">
              {/* Image at top */}
              {editSelectedImage ? (
                <Image
                  source={{ uri: editSelectedImage }}
                  style={styles.detailImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.detailImage, styles.detailImagePlaceholder]}>
                  <ThemedText style={styles.placeholderText}>No Image</ThemedText>
                </View>
              )}

              {/* Form below image */}
              <View style={styles.detailEditForm}>
                <View style={styles.detailInfoRow}>
                  <ThemedText style={styles.detailInfoLabel}>Status:</ThemedText>
                  <View
                    style={[
                      styles.statusBadge,
                      selectedRequest.status === 'approved' && styles.statusApproved,
                      selectedRequest.status === 'denied' && styles.statusDenied,
                    ]}>
                    <ThemedText style={styles.statusText}>{selectedRequest.status}</ThemedText>
                  </View>
                </View>

                <ThemedText style={styles.detailRequestedBy}>
                  Requested by: {selectedRequest.requested_by_name} ({selectedRequest.requested_by_email})
                </ThemedText>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Location Name *</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="Location name"
                    placeholderTextColor="#888888"
                    value={editName}
                    onChangeText={setEditName}
                    maxLength={MAX_LOCATION_NAME_LEN}
                    returnKeyType="next"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    blurOnSubmit={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Address *</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="Full address"
                    placeholderTextColor="#888888"
                    value={editAddress}
                    onChangeText={setEditAddress}
                    multiline
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Description</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="What is this place known for?"
                    placeholderTextColor="#888888"
                    value={editDescription}
                    onChangeText={setEditDescription}
                    multiline
                    numberOfLines={4}
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Top Qualities</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Enter top qualities separated by commas (e.g., Coffee, WiFi, Quiet)"
                    placeholderTextColor="#888888"
                    value={editTopQualities}
                    onChangeText={setEditTopQualities}
                    multiline
                    numberOfLines={3}
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                  <ThemedText style={styles.hintText}>
                    Use commas to create bubbles (e.g., Coffee, WiFi, Quiet).
                  </ThemedText>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Level of Business</ThemedText>
                  <View style={styles.buttonRow}>
                    {(['high', 'moderate', 'low'] as const).map((level) => (
                      <TouchableOpacity
                        key={level}
                        style={[
                          styles.levelButton,
                          editLevelOfBusiness === level && styles.levelButtonActive,
                        ]}
                        onPress={() => setEditLevelOfBusiness(level)}>
                        <ThemedText
                          style={[
                            styles.levelButtonText,
                            editLevelOfBusiness === level && styles.levelButtonTextActive,
                          ]}>
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Image</ThemedText>
                  <TouchableOpacity
                    style={styles.imagePickerButton}
                    onPress={pickEditImage}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.imagePickerButtonText}>
                      {editSelectedImage ? 'Change Image' : 'Choose from Camera Roll'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Admin Notes</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Admin notes (only visible to requester)"
                    placeholderTextColor="#888888"
                    value={editAdminNotes}
                    onChangeText={setEditAdminNotes}
                    multiline
                    numberOfLines={3}
                    returnKeyType="done"
                    blurOnSubmit={true}
                  />
                </View>

                <ThemedText style={styles.detailEditHint}>
                  Edit above if needed. Save Changes updates the request; Submit Location posts it to Manage Locations (Posted) and removes it from requests.
                </ThemedText>

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleUpdateRequest}
                  disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.submitButtonText}>Save Changes</ThemedText>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitLocationButton, loading && styles.submitButtonDisabled]}
                  onPress={handleSubmitRequestAsLocation}
                  disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.submitButtonText}>Submit Location</ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
        </Modal>
        </Animated.View>
      </ThemedView>
    );
  }

  // Manage locations page
  if (currentPage === 'manage-locations') {
    return (
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.pageContainer,
            {
              transform: [{ translateX: slideAnim }],
            },
          ]}>
          {renderPageHeader('Manage Locations', 
          userIsAdmin ? (
            <TouchableOpacity
              style={styles.headerPlusButton}
              onPress={() => setShowCreateLocationModal(true)}
              activeOpacity={0.7}>
              <IconSymbol name="plus.circle.fill" size={24} color="#5FA8D3" />
            </TouchableOpacity>
          ) : undefined
        )}
        <View style={styles.searchBarWrap}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search locations by name or address..."
            placeholderTextColor="#888888"
            value={locationSearch}
            onChangeText={setLocationSearch}
          />
        </View>
        <TouchableWithoutFeedback onPress={() => setStatusMenuOpen(null)}>
          <ScrollView
            contentContainerStyle={[
              styles.listContent,
              styles.manageLocationsContent,
              { paddingBottom: insets.bottom + 20 },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }>
            {(locationSearch.trim() ? locations.filter((l) => {
              const q = locationSearch.trim().toLowerCase();
              return (l.name || '').toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q);
            }) : locations).map((location, index) => (
              <TouchableOpacity
                key={`${location.id || 'location'}-${index}`}
                style={styles.requestCard}
                onPress={() => openLocationDetail(location)}
                activeOpacity={0.9}>
                <View style={styles.requestHeader}>
                  <ThemedText style={styles.requestName}>{location.name}</ThemedText>
                  <TouchableOpacity
                    style={styles.deleteIconButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      Alert.alert(
                        'Delete Location',
                        'Are you sure you want to delete this location?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await apiService.deleteLocation(location.id);
                                loadLocations();
                              } catch (error: any) {
                                Alert.alert('Error', error.response?.data?.detail || 'Failed to delete location');
                              }
                            },
                          },
                        ]
                      );
                    }}
                    activeOpacity={0.7}>
                    <IconSymbol name="trash.fill" size={20} color="#FF6B6B" />
                  </TouchableOpacity>
                </View>

                <ThemedText style={styles.requestAddress}>{location.address}</ThemedText>

                {location.most_known_for && (
                  <ThemedText style={styles.requestDescription}>{location.most_known_for}</ThemedText>
                )}

                {location.level_of_business && (
                  <ThemedText style={styles.requestLevel}>
                    Business Level: {location.level_of_business}
                  </ThemedText>
                )}

                {location.rating !== undefined && (
                  <ThemedText style={styles.requestBy}>
                    Rating: {location.rating?.toFixed(1) || '0.0'} ({location.reviews_count || 0} reviews)
                  </ThemedText>
                )}
              </TouchableOpacity>
            ))}

            {locations.length === 0 && (
              <View style={styles.emptyContainer}>
                <ThemedText style={styles.emptyText}>No locations found</ThemedText>
              </View>
            )}
          </ScrollView>
        </TouchableWithoutFeedback>

        {/* Location Detail Modal */}
        <Modal
          visible={showLocationDetailModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowLocationDetailModal(false)}>
          {selectedLocation && (
            <View style={styles.detailModalContainer}>
              <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                <TouchableOpacity onPress={() => setShowLocationDetailModal(false)}>
                  <ThemedText style={styles.backButton}>←</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.detailHeaderTitle}>{selectedLocation.name}</ThemedText>
                <View style={{ width: 40 }} />
              </View>

              <ScrollView
                style={styles.detailScrollView}
                contentContainerStyle={[
                  styles.detailContent,
                  { paddingBottom: insets.bottom + 40 },
                ]}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
              {editLocationSelectedImages.length > 0 ? (
                editLocationSelectedImages.length === 1 ? (
                  <Image
                    source={{ uri: editLocationSelectedImages[0] }}
                    style={styles.detailImage}
                    resizeMode="cover"
                  />
                ) : (
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={true}
                    style={{ width: SCREEN_WIDTH, height: 400 }}
                  >
                    {editLocationSelectedImages.map((uri, idx) => (
                      <Image
                        key={`${uri}-${idx}`}
                        source={{ uri }}
                        style={{ width: SCREEN_WIDTH, height: 400 }}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                )
              ) : (
                <View style={[styles.detailImage, styles.detailImagePlaceholder]}>
                  <ThemedText style={styles.placeholderText}>No Image</ThemedText>
                </View>
              )}

                <View style={styles.detailEditForm}>
                  {selectedLocation.rating !== undefined && (
                    <View style={styles.detailInfoRow}>
                      <ThemedText style={styles.detailInfoLabel}>Rating:</ThemedText>
                      <ThemedText style={styles.detailInfoText}>
                        {selectedLocation.rating?.toFixed(1) || '0.0'} ({selectedLocation.reviews_count || 0} reviews)
                      </ThemedText>
                    </View>
                  )}

                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Location Name *</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Location name"
                      placeholderTextColor="#888888"
                      value={editLocationName}
                      onChangeText={setEditLocationName}
                      maxLength={MAX_ANNOUNCEMENT_TITLE_LEN}
                      returnKeyType="next"
                      onSubmitEditing={() => Keyboard.dismiss()}
                      blurOnSubmit={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Description (optional)</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Short description of this place"
                      placeholderTextColor="#888888"
                      value={editLocationDescription}
                      onChangeText={setEditLocationDescription}
                      multiline
                      numberOfLines={3}
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Address *</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Full address"
                      placeholderTextColor="#888888"
                      value={editLocationAddress}
                      onChangeText={setEditLocationAddress}
                      multiline
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Top Qualities</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Enter top qualities separated by commas (e.g., Coffee, WiFi, Quiet)"
                      placeholderTextColor="#888888"
                      value={editLocationTopQualities}
                      onChangeText={setEditLocationTopQualities}
                      multiline
                      numberOfLines={3}
                      returnKeyType="next"
                      blurOnSubmit={false}
                    />
                    <ThemedText style={styles.hintText}>
                      Use commas to create bubbles (e.g., Coffee, WiFi, Quiet).
                    </ThemedText>
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Level of Business</ThemedText>
                    <View style={styles.buttonRow}>
                      {(['high', 'moderate', 'low'] as const).map((level) => (
                        <TouchableOpacity
                          key={level}
                          style={[
                            styles.levelButton,
                            editLocationLevelOfBusiness === level && styles.levelButtonActive,
                          ]}
                          onPress={() => setEditLocationLevelOfBusiness(level)}>
                          <ThemedText
                            style={[
                              styles.levelButtonText,
                              editLocationLevelOfBusiness === level && styles.levelButtonTextActive,
                            ]}>
                            {level.charAt(0).toUpperCase() + level.slice(1)}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Image</ThemedText>
                    <TouchableOpacity
                      style={styles.imagePickerButton}
                      onPress={pickEditLocationImages}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.imagePickerButtonText}>
                        {editLocationSelectedImages.length > 0 ? 'Add Photos' : 'Choose from Camera Roll'}
                      </ThemedText>
                    </TouchableOpacity>
                    {editLocationSelectedImages.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewRow}>
                        {editLocationSelectedImages.map((uri, idx) => (
                          <View key={`${uri}-${idx}`} style={styles.imagePreviewThumbWrap}>
                            <Image source={{ uri }} style={styles.imagePreviewThumb} resizeMode="cover" />
                            <View style={styles.imagePreviewActions}>
                              <TouchableOpacity
                                style={styles.imagePreviewActionButton}
                                onPress={() =>
                                  setEditLocationSelectedImages((prev) => moveImage(prev, idx, 'left'))
                                }
                                disabled={idx === 0}
                                activeOpacity={0.7}>
                                <ThemedText style={styles.imagePreviewActionText}>‹</ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.imagePreviewActionButton}
                                onPress={() =>
                                  setEditLocationSelectedImages((prev) => moveImage(prev, idx, 'right'))
                                }
                                disabled={idx === editLocationSelectedImages.length - 1}
                                activeOpacity={0.7}>
                                <ThemedText style={styles.imagePreviewActionText}>›</ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.imagePreviewActionButton, styles.imagePreviewRemoveButton]}
                                onPress={() =>
                                  setEditLocationSelectedImages((prev) => prev.filter((_, i) => i !== idx))
                                }
                                activeOpacity={0.7}>
                                <ThemedText style={styles.imagePreviewActionText}>✕</ThemedText>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                    onPress={handleUpdateLocation}
                    disabled={loading}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.submitButtonText}>Save Changes</ThemedText>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.submitButton, styles.deleteButton, { marginTop: 12 }]}
                    onPress={() => {
                      Alert.alert(
                        'Delete Location',
                        'Are you sure you want to delete this location?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await apiService.deleteLocation(selectedLocation.id);
                                Alert.alert('Success', 'Location deleted successfully');
                                loadLocations();
                                setShowLocationDetailModal(false);
                              } catch (error: any) {
                                Alert.alert('Error', error.response?.data?.detail || 'Failed to delete location');
                              }
                            },
                          },
                        ]
                      );
                    }}>
                    <ThemedText style={styles.submitButtonText}>Delete Location</ThemedText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          )}
        </Modal>

        {/* Create Location Modal */}
        <Modal
          visible={showCreateLocationModal}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowCreateLocationModal(false)}>
          <View style={styles.detailModalContainer}>
            <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
              <TouchableOpacity onPress={() => setShowCreateLocationModal(false)}>
                <ThemedText style={styles.backButton}>←</ThemedText>
              </TouchableOpacity>
              <ThemedText style={styles.detailHeaderTitle}>Create New Location</ThemedText>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              style={styles.detailScrollView}
              contentContainerStyle={styles.detailContent}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
              {newLocationSelectedImages.length > 0 && (
                newLocationSelectedImages.length === 1 ? (
                  <Image
                    source={{ uri: newLocationSelectedImages[0] }}
                    style={styles.detailImage}
                    resizeMode="cover"
                  />
                ) : (
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={true}
                    style={{ width: SCREEN_WIDTH, height: 400 }}
                  >
                    {newLocationSelectedImages.map((uri, idx) => (
                      <Image
                        key={`${uri}-${idx}`}
                        source={{ uri }}
                        style={{ width: SCREEN_WIDTH, height: 400 }}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                )
              )}
              <View style={styles.detailEditForm}>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Location Name *</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="Location name"
                    placeholderTextColor="#888888"
                    value={newLocationName}
                    onChangeText={setNewLocationName}
                    maxLength={MAX_LOCATION_NAME_LEN}
                    returnKeyType="next"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    blurOnSubmit={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Description (optional)</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Short description of this place"
                    placeholderTextColor="#888888"
                    value={newLocationDescription}
                    onChangeText={setNewLocationDescription}
                    multiline
                    numberOfLines={3}
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Address *</ThemedText>
                  <TextInput
                    style={styles.input}
                    placeholder="Full address"
                    placeholderTextColor="#888888"
                    value={newLocationAddress}
                    onChangeText={setNewLocationAddress}
                    multiline
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Top Qualities</ThemedText>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Enter top qualities separated by commas (e.g., Coffee, WiFi, Quiet)"
                    placeholderTextColor="#888888"
                    value={newLocationTopQualities}
                    onChangeText={setNewLocationTopQualities}
                    multiline
                    numberOfLines={3}
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                  <ThemedText style={styles.hintText}>
                    Use commas to create bubbles (e.g., Coffee, WiFi, Quiet).
                  </ThemedText>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Level of Business</ThemedText>
                  <View style={styles.buttonRow}>
                    {(['high', 'moderate', 'low'] as const).map((level) => (
                      <TouchableOpacity
                        key={level}
                        style={[
                          styles.levelButton,
                          newLocationLevelOfBusiness === level && styles.levelButtonActive,
                        ]}
                        onPress={() => setNewLocationLevelOfBusiness(level)}>
                        <ThemedText
                          style={[
                            styles.levelButtonText,
                            newLocationLevelOfBusiness === level && styles.levelButtonTextActive,
                          ]}>
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Image (optional)</ThemedText>
                  <TouchableOpacity
                    style={styles.imagePickerButton}
                    onPress={pickNewLocationImages}
                    activeOpacity={0.7}>
                    <ThemedText style={styles.imagePickerButtonText}>
                      {newLocationSelectedImages.length > 0 ? 'Add Photos' : 'Choose from Camera Roll'}
                    </ThemedText>
                  </TouchableOpacity>
                  {newLocationSelectedImages.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewRow}>
                      {newLocationSelectedImages.map((uri, idx) => (
                        <View key={`${uri}-${idx}`} style={styles.imagePreviewThumbWrap}>
                          <Image source={{ uri }} style={styles.imagePreviewThumb} resizeMode="cover" />
                          <View style={styles.imagePreviewActions}>
                            <TouchableOpacity
                              style={styles.imagePreviewActionButton}
                              onPress={() =>
                                setNewLocationSelectedImages((prev) => moveImage(prev, idx, 'left'))
                              }
                              disabled={idx === 0}
                              activeOpacity={0.7}>
                              <ThemedText style={styles.imagePreviewActionText}>‹</ThemedText>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.imagePreviewActionButton}
                              onPress={() =>
                                setNewLocationSelectedImages((prev) => moveImage(prev, idx, 'right'))
                              }
                              disabled={idx === newLocationSelectedImages.length - 1}
                              activeOpacity={0.7}>
                              <ThemedText style={styles.imagePreviewActionText}>›</ThemedText>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.imagePreviewActionButton, styles.imagePreviewRemoveButton]}
                              onPress={() =>
                                setNewLocationSelectedImages((prev) => prev.filter((_, i) => i !== idx))
                              }
                              activeOpacity={0.7}>
                              <ThemedText style={styles.imagePreviewActionText}>✕</ThemedText>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleCreateLocation}
                  disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.submitButtonText}>Create Location</ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </Modal>
        </Animated.View>
      </ThemedView>
    );
  }

  // Manage announcements page
  if (currentPage === 'manage-announcements') {
    const byStatus = announcementsFilter === 'posted'
      ? announcements.filter((a) => a.status === 'published')
      : announcementsFilter === 'drafts'
        ? announcements.filter((a) => a.status === 'draft')
        : [];
    const filteredAnnouncements = announcementSearch.trim()
      ? byStatus.filter((a) => {
          const q = announcementSearch.trim().toLowerCase();
          return (a.title || '').toLowerCase().includes(q) || (a.body || '').toLowerCase().includes(q);
        })
      : byStatus;

    return (
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        <Animated.View style={[styles.pageContainer, { transform: [{ translateX: slideAnim }] }]}>
          {renderPageHeader('Announcements', (
            <TouchableOpacity
              style={styles.headerPlusButton}
              onPress={() => {
                setNewAnnouncementTitle('');
                setNewAnnouncementBody('');
                setNewAnnouncementImage(null);
                setShowCreateAnnouncementModal(true);
              }}
              activeOpacity={0.7}>
              <IconSymbol name="plus.circle.fill" size={24} color="#5FA8D3" />
            </TouchableOpacity>
          ))}
          <View style={styles.searchBarWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search announcements by title or body..."
              placeholderTextColor="#888888"
              value={announcementSearch}
              onChangeText={setAnnouncementSearch}
            />
          </View>
          <View style={styles.placesViewToggle}>
            <TouchableOpacity
              style={[styles.placesViewTab, announcementsFilter === 'posted' && styles.placesViewTabActive]}
              onPress={() => setAnnouncementsFilter('posted')}
              activeOpacity={0.7}>
              <ThemedText style={[styles.placesViewTabText, announcementsFilter === 'posted' && styles.placesViewTabTextActive]}>
                Posted
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.placesViewTab, announcementsFilter === 'drafts' && styles.placesViewTabActive]}
              onPress={() => setAnnouncementsFilter('drafts')}
              activeOpacity={0.7}>
              <ThemedText style={[styles.placesViewTabText, announcementsFilter === 'drafts' && styles.placesViewTabTextActive]}>
                Drafts
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.placesViewTab, announcementsFilter === 'request' && styles.placesViewTabActive]}
              onPress={() => setAnnouncementsFilter('request')}
              activeOpacity={0.7}>
              <ThemedText style={[styles.placesViewTabText, announcementsFilter === 'request' && styles.placesViewTabTextActive]}>
                Request
              </ThemedText>
            </TouchableOpacity>
          </View>
          <TouchableWithoutFeedback onPress={() => setStatusMenuOpen(null)}>
            <ScrollView
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
              {announcementsFilter === 'request' ? (
                <>
              <ThemedText style={styles.sectionLabel}>Student announcement requests</ThemedText>
              {announcementRequests.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>No requests</ThemedText>
                </View>
              ) : (
                announcementRequests.map((ar, index) => (
                  <View key={`${ar.id || 'announcement-request'}-${index}`} style={styles.requestCard}>
                    {ar.image ? (
                      <Image source={{ uri: ar.image }} style={styles.announcementCardImage} resizeMode="cover" />
                    ) : null}
                    <View style={styles.requestHeader}>
                      <ThemedText style={styles.requestName} numberOfLines={1}>{ar.title}</ThemedText>
                      <View style={[styles.statusBadge, ar.status === 'approved' && styles.statusApproved, ar.status === 'denied' && styles.statusDenied, ar.status === 'pending' && styles.statusSubmitted]}>
                        <ThemedText style={styles.statusText}>{ar.status}</ThemedText>
                      </View>
                    </View>
                    <ThemedText style={styles.requestDescription} numberOfLines={2}>{ar.body}</ThemedText>
                    <ThemedText style={styles.requestBy}>
                      From {ar.requested_by_name || 'Unknown'} · {new Date(ar.created_at).toLocaleDateString()}
                    </ThemedText>
                    {ar.status === 'pending' && (
                      <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.approveButton]}
                          onPress={async () => {
                            try {
                              await apiService.approveAnnouncementRequest(ar.id);
                              loadAnnouncementRequests();
                              loadAnnouncements();
                            } catch (e: any) {
                              Alert.alert('Error', e?.response?.data?.detail || 'Failed to approve');
                            }
                          }}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.actionButtonText}>Approve</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.denyButton]}
                          onPress={() => {
                            setSelectedAnnouncementRequestToDeny(ar);
                            setDenyAnnouncementRequestNotes('');
                            setShowDenyAnnouncementRequestModal(true);
                          }}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.actionButtonText}>Deny</ThemedText>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
                </>
              ) : (
                <>
              <ThemedText style={styles.sectionLabel}>{announcementsFilter === 'posted' ? 'Posted' : 'Drafts'}</ThemedText>
              {filteredAnnouncements.map((a, index) => (
                <View key={`${a.id || 'announcement'}-${index}`} style={styles.requestCard}>
                  {a.image ? (
                    <Image source={{ uri: a.image }} style={styles.announcementCardImage} resizeMode="cover" />
                  ) : null}
                  <View style={styles.requestHeader}>
                    <ThemedText style={styles.requestName} numberOfLines={1}>{a.title}</ThemedText>
                    <View style={[styles.statusBadge, a.status === 'published' && styles.statusApproved, a.status === 'draft' && styles.statusSubmitted]}>
                      <ThemedText style={styles.statusText}>{a.status}</ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.requestDescription} numberOfLines={2}>{a.body}</ThemedText>
                  <ThemedText style={styles.requestBy}>
                    {a.published_at ? `Published ${new Date(a.published_at).toLocaleDateString()}` : `Created ${new Date(a.created_at).toLocaleDateString()}`}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.approveButton]}
                      onPress={() => {
                        setSelectedAnnouncement(a);
                        setEditAnnouncementTitle(a.title);
                        setEditAnnouncementBody(a.body);
                        setEditAnnouncementImage(a.image || null);
                        setShowEditAnnouncementModal(true);
                      }}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.actionButtonText}>Edit</ThemedText>
                    </TouchableOpacity>
                    {a.status === 'draft' ? (
                      <TouchableOpacity
                        style={[styles.actionButton, styles.approveButton]}
                        onPress={async () => {
                          try {
                            await apiService.publishAnnouncement(a.id);
                            loadAnnouncements();
                          } catch (e: any) {
                            Alert.alert('Error', e?.response?.data?.detail || 'Failed to publish');
                          }
                        }}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.actionButtonText}>Publish</ThemedText>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: '#FFA726' }]}
                        onPress={async () => {
                          try {
                            await apiService.unpublishAnnouncement(a.id);
                            loadAnnouncements();
                          } catch (e: any) {
                            Alert.alert('Error', e?.response?.data?.detail || 'Failed to unpublish');
                          }
                        }}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.actionButtonText}>Unpublish</ThemedText>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.actionButton, styles.denyButton]}
                      onPress={() => {
                        Alert.alert(
                          'Delete Announcement',
                          'Are you sure you want to delete this announcement?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  await apiService.deleteAnnouncement(a.id);
                                  loadAnnouncements();
                                } catch (e: any) {
                                  Alert.alert('Error', e?.response?.data?.detail || 'Failed to delete');
                                }
                              },
                            },
                          ]
                        );
                      }}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.actionButtonText}>Delete</ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {filteredAnnouncements.length === 0 && !loading && (
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>
                    {announcementSearch.trim() ? 'No announcements match your search' : announcementsFilter === 'posted' ? 'No posted announcements yet' : 'No drafts yet'}
                  </ThemedText>
                </View>
              )}
              {filteredAnnouncements.length === 0 && loading && (
                <View style={styles.emptyContainer}>
                  <ActivityIndicator size="large" color="#5FA8D3" />
                </View>
              )}
                </>
              )}

            </ScrollView>
          </TouchableWithoutFeedback>

          {/* Create Announcement Modal */}
          <Modal
            visible={showCreateAnnouncementModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowCreateAnnouncementModal(false)}>
            <View style={styles.detailModalContainer}>
              <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                <TouchableOpacity onPress={() => setShowCreateAnnouncementModal(false)}>
                  <ThemedText style={styles.backButton}>←</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.detailHeaderTitle}>New Announcement</ThemedText>
                <View style={{ width: 40 }} />
              </View>
              <ScrollView
                style={styles.detailScrollView}
                contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                <View style={styles.detailEditForm}>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Title *</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Announcement title"
                      placeholderTextColor="#888888"
                      value={newAnnouncementTitle}
                      onChangeText={setNewAnnouncementTitle}
                      maxLength={MAX_ANNOUNCEMENT_TITLE_LEN}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Body *</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Announcement body"
                      placeholderTextColor="#888888"
                      value={newAnnouncementBody}
                      onChangeText={setNewAnnouncementBody}
                      multiline
                      numberOfLines={6}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Image (optional)</ThemedText>
                    {newAnnouncementImage ? (
                      <View style={styles.announcementImagePreviewWrap}>
                        <Image source={{ uri: newAnnouncementImage }} style={styles.announcementImagePreview} resizeMode="cover" />
                        <TouchableOpacity style={styles.removeImageButton} onPress={() => setNewAnnouncementImage(null)}>
                          <ThemedText style={styles.removeImageButtonText}>Remove</ThemedText>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.imagePickerButton} onPress={pickNewAnnouncementImage} activeOpacity={0.7}>
                        <ThemedText style={styles.imagePickerButtonText}>Choose Image</ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.submitButton, (loading || !newAnnouncementTitle.trim() || !newAnnouncementBody.trim()) && styles.submitButtonDisabled]}
                    disabled={loading || !newAnnouncementTitle.trim() || !newAnnouncementBody.trim()}
                    onPress={async () => {
                      setLoading(true);
                      try {
                        const image = getSafeUploadImage(newAnnouncementImage);
                        await apiService.createAnnouncement({
                          title: newAnnouncementTitle.trim(),
                          body: newAnnouncementBody.trim(),
                          image,
                        });
                        setNewAnnouncementTitle('');
                        setNewAnnouncementBody('');
                        setNewAnnouncementImage(null);
                        setShowCreateAnnouncementModal(false);
                        loadAnnouncements();
                      } catch (e: any) {
                        Alert.alert('Error', e?.response?.data?.detail || 'Failed to create');
                      } finally {
                        setLoading(false);
                      }
                    }}>
                    <ThemedText style={styles.submitButtonText}>Create Draft</ThemedText>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </Modal>

          {/* Edit Announcement Modal */}
          <Modal
            visible={showEditAnnouncementModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowEditAnnouncementModal(false)}>
            {selectedAnnouncement && (
              <View style={styles.detailModalContainer}>
                <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                  <TouchableOpacity onPress={() => setShowEditAnnouncementModal(false)}>
                    <ThemedText style={styles.backButton}>←</ThemedText>
                  </TouchableOpacity>
                  <ThemedText style={styles.detailHeaderTitle}>Edit Announcement</ThemedText>
                  <View style={{ width: 40 }} />
                </View>
                <ScrollView
                  style={styles.detailScrollView}
                  contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 40 }]}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
                  <View style={styles.detailEditForm}>
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Title *</ThemedText>
                      <TextInput
                        style={styles.input}
                        placeholder="Title"
                        placeholderTextColor="#888888"
                        value={editAnnouncementTitle}
                        onChangeText={setEditAnnouncementTitle}
                      maxLength={MAX_ANNOUNCEMENT_TITLE_LEN}
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Body *</ThemedText>
                      <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder="Body"
                        placeholderTextColor="#888888"
                        value={editAnnouncementBody}
                        onChangeText={setEditAnnouncementBody}
                        multiline
                        numberOfLines={6}
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Image (optional)</ThemedText>
                      {editAnnouncementImage ? (
                        <View style={styles.announcementImagePreviewWrap}>
                          <Image source={{ uri: editAnnouncementImage }} style={styles.announcementImagePreview} resizeMode="cover" />
                          <TouchableOpacity style={styles.removeImageButton} onPress={() => setEditAnnouncementImage(null)}>
                            <ThemedText style={styles.removeImageButtonText}>Remove</ThemedText>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity style={styles.imagePickerButton} onPress={pickEditAnnouncementImage} activeOpacity={0.7}>
                          <ThemedText style={styles.imagePickerButtonText}>Choose Image</ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.submitButton, (loading || !editAnnouncementTitle.trim() || !editAnnouncementBody.trim()) && styles.submitButtonDisabled]}
                      disabled={loading || !editAnnouncementTitle.trim() || !editAnnouncementBody.trim()}
                      onPress={async () => {
                        setLoading(true);
                        try {
                          const image = getSafeUploadImage(editAnnouncementImage);
                          await apiService.patchAnnouncement(selectedAnnouncement.id, {
                            title: editAnnouncementTitle.trim(),
                            body: editAnnouncementBody.trim(),
                            image: image !== undefined ? image : '',
                          });
                          setShowEditAnnouncementModal(false);
                          loadAnnouncements();
                        } catch (e: any) {
                          Alert.alert('Error', e?.response?.data?.detail || 'Failed to update');
                        } finally {
                          setLoading(false);
                        }
                      }}>
                      <ThemedText style={styles.submitButtonText}>Save</ThemedText>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            )}
          </Modal>

          {/* Deny announcement request modal */}
          <Modal
            visible={showDenyAnnouncementRequestModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowDenyAnnouncementRequestModal(false)}>
            <TouchableWithoutFeedback onPress={() => setShowDenyAnnouncementRequestModal(false)}>
              <View style={styles.denyModalOverlay}>
                <View style={styles.denyModalContent} onStartShouldSetResponder={() => true}>
                    <ThemedText style={styles.denyModalTitle}>Deny request</ThemedText>
                    <ThemedText style={styles.label}>Reason (optional)</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Add a note for the student..."
                      placeholderTextColor="#888888"
                      value={denyAnnouncementRequestNotes}
                      onChangeText={setDenyAnnouncementRequestNotes}
                      multiline
                    />
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                      <TouchableOpacity
                        style={[styles.actionButton, { flex: 1, backgroundColor: '#8B7355' }]}
                        onPress={() => setShowDenyAnnouncementRequestModal(false)}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.actionButtonText}>Cancel</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.denyButton, { flex: 1 }]}
                        onPress={async () => {
                          if (!selectedAnnouncementRequestToDeny) return;
                          try {
                            await apiService.denyAnnouncementRequest(selectedAnnouncementRequestToDeny.id, denyAnnouncementRequestNotes.trim() || undefined);
                            loadAnnouncementRequests();
                            setShowDenyAnnouncementRequestModal(false);
                            setSelectedAnnouncementRequestToDeny(null);
                            setDenyAnnouncementRequestNotes('');
                          } catch (e: any) {
                            Alert.alert('Error', e?.response?.data?.detail || 'Failed to deny');
                          }
                        }}
                        activeOpacity={0.7}>
                        <ThemedText style={styles.actionButtonText}>Deny</ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
              </View>
            </TouchableWithoutFeedback>
          </Modal>

        </Animated.View>
      </ThemedView>
    );
  }

  // Manage events page
  if (currentPage === 'manage-events') {
    const filteredEvents = eventSearch.trim()
      ? events.filter((e) => {
          const q = eventSearch.trim().toLowerCase();
          return (e.event_name || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q);
        })
      : events;
    const filteredEventRequests = eventSearch.trim()
      ? eventRequests.filter((e) => {
          const q = eventSearch.trim().toLowerCase();
          return (e.event_name || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q);
        })
      : eventRequests;

    return (
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        <Animated.View style={[styles.pageContainer, { transform: [{ translateX: slideAnim }] }]}>
          {renderPageHeader('Events', (
            <TouchableOpacity
              style={styles.headerPlusButton}
              onPress={() => {
                setNewEventName('');
                setNewEventLocation('');
                setNewEventTopQualities('');
                setNewEventDescription('');
                setNewEventMeetingTime('');
                setNewEventImage(null);
                setShowCreateEventModal(true);
              }}
              activeOpacity={0.7}>
              <IconSymbol name="plus.circle.fill" size={24} color="#5FA8D3" />
            </TouchableOpacity>
          ))}
          <View style={styles.searchBarWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search events by name or description..."
              placeholderTextColor="#888888"
              value={eventSearch}
              onChangeText={setEventSearch}
            />
          </View>
          <View style={styles.placesViewToggle}>
            <TouchableOpacity
              style={[styles.placesViewTab, eventsFilter === 'posted' && styles.placesViewTabActive]}
              onPress={() => setEventsFilter('posted')}
              activeOpacity={0.7}>
              <ThemedText style={[styles.placesViewTabText, eventsFilter === 'posted' && styles.placesViewTabTextActive]}>
                Posted
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.placesViewTab, eventsFilter === 'requests' && styles.placesViewTabActive]}
              onPress={() => setEventsFilter('requests')}
              activeOpacity={0.7}>
              <ThemedText style={[styles.placesViewTabText, eventsFilter === 'requests' && styles.placesViewTabTextActive]}>
                Requests
              </ThemedText>
            </TouchableOpacity>
          </View>
          <TouchableWithoutFeedback onPress={() => setStatusMenuOpen(null)}>
            <ScrollView
              contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
              {eventsFilter === 'requests' ? (
                <>
                  {filteredEventRequests.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <ThemedText style={styles.emptyText}>No event requests</ThemedText>
                    </View>
                  ) : (
                    filteredEventRequests.map((er, index) => (
                      <View key={`${er.id || 'event-request'}-${index}`} style={styles.requestCard}>
                        {er.picture ? (
                          <Image source={{ uri: er.picture }} style={styles.announcementCardImage} resizeMode="cover" />
                        ) : null}
                        <View style={styles.requestHeader}>
                          <ThemedText style={styles.requestName} numberOfLines={1}>{er.event_name}</ThemedText>
                          <View style={[styles.statusBadge, er.status === 'denied' && styles.statusDenied, er.status === 'pending' && styles.statusSubmitted]}>
                            <ThemedText style={styles.statusText}>{er.status}</ThemedText>
                          </View>
                        </View>
                        {er.meeting_time ? (
                          <ThemedText style={styles.requestBy}>Meeting time: {er.meeting_time}</ThemedText>
                        ) : null}
                        {er.location ? (
                          <ThemedText style={styles.requestBy}>Location: {er.location}</ThemedText>
                        ) : null}
                        {er.description ? (
                          <ThemedText style={styles.requestDescription} numberOfLines={2}>{er.description}</ThemedText>
                        ) : null}
                        {renderQualitiesPills(er.top_qualities)}
                        <ThemedText style={styles.requestBy}>
                          From {er.requested_by_name || 'Unknown'} · {new Date(er.created_at).toLocaleDateString()}
                        </ThemedText>
                        {er.status === 'pending' && (
                          <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
                            <TouchableOpacity
                              style={[styles.actionButton, styles.approveButton]}
                              onPress={() => openEventRequestDetail(er)}
                              activeOpacity={0.7}>
                              <ThemedText style={styles.actionButtonText}>Edit</ThemedText>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.actionButton, styles.approveButton]}
                              onPress={() => handleApproveEventRequest(er.id)}
                              activeOpacity={0.7}>
                              <ThemedText style={styles.actionButtonText}>Approve</ThemedText>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.actionButton, styles.denyButton]}
                              onPress={() => handleDenyEventRequest(er.id)}
                              activeOpacity={0.7}>
                              <ThemedText style={styles.actionButtonText}>Deny</ThemedText>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))
                  )}
                </>
              ) : (
                <>
                  {filteredEvents.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <ThemedText style={styles.emptyText}>No posted events yet</ThemedText>
                    </View>
                  ) : (
                    filteredEvents.map((ev, index) => (
                      <View key={`${ev.id || 'event'}-${index}`} style={styles.requestCard}>
                        {ev.picture ? (
                          <Image source={{ uri: ev.picture }} style={styles.announcementCardImage} resizeMode="cover" />
                        ) : null}
                        <View style={styles.requestHeader}>
                          <ThemedText style={styles.requestName} numberOfLines={1}>{ev.event_name}</ThemedText>
                          <View style={[styles.statusBadge, styles.statusApproved]}>
                            <ThemedText style={styles.statusText}>posted</ThemedText>
                          </View>
                        </View>
                        {ev.meeting_time ? (
                          <ThemedText style={styles.requestBy}>Meeting time: {ev.meeting_time}</ThemedText>
                        ) : null}
                        {ev.location ? (
                          <ThemedText style={styles.requestBy}>Location: {ev.location}</ThemedText>
                        ) : null}
                        {ev.description ? (
                          <ThemedText style={styles.requestDescription} numberOfLines={2}>{ev.description}</ThemedText>
                        ) : null}
                        {renderQualitiesPills(ev.top_qualities)}
                        <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.approveButton]}
                            onPress={() => openPostedEventDetail(ev)}
                            activeOpacity={0.7}>
                            <ThemedText style={styles.actionButtonText}>Edit</ThemedText>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.denyButton]}
                            onPress={() => {
                              Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: async () => {
                                    try {
                                      await apiService.deleteEvent(ev.id);
                                      loadEvents();
                                    } catch (e: any) {
                                      Alert.alert('Error', e?.response?.data?.detail || 'Failed to delete event');
                                    }
                                  },
                                },
                              ]);
                            }}
                            activeOpacity={0.7}>
                            <ThemedText style={styles.actionButtonText}>Delete</ThemedText>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))
                  )}
                </>
              )}
            </ScrollView>
          </TouchableWithoutFeedback>

          {/* Edit Event Request Modal */}
          <Modal
            visible={showEditEventRequestModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowEditEventRequestModal(false)}>
            <View style={styles.detailModalContainer}>
              <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                <TouchableOpacity onPress={() => setShowEditEventRequestModal(false)}>
                  <ThemedText style={styles.backButton}>←</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.detailHeaderTitle}>Event Request</ThemedText>
                <View style={{ width: 40 }} />
              </View>
              <ScrollView
                style={styles.detailScrollView}
                contentContainerStyle={styles.detailContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                <View style={styles.detailEditForm}>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Event name *</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Event name"
                      placeholderTextColor="#888888"
                      value={editEventName}
                      onChangeText={setEditEventName}
                        maxLength={MAX_ANNOUNCEMENT_TITLE_LEN}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Location</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Where is it?"
                      placeholderTextColor="#888888"
                      value={editEventLocation}
                      onChangeText={setEditEventLocation}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Meeting time</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Fri 6pm, Room 101"
                      placeholderTextColor="#888888"
                      value={editEventMeetingTime}
                      onChangeText={setEditEventMeetingTime}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Description</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Describe the event"
                      placeholderTextColor="#888888"
                      value={editEventDescription}
                      onChangeText={setEditEventDescription}
                      multiline
                      numberOfLines={4}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Top qualities</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="e.g. Food, Networking, Live music"
                      placeholderTextColor="#888888"
                      value={editEventTopQualities}
                      onChangeText={setEditEventTopQualities}
                      multiline
                      numberOfLines={3}
                    />
                    <ThemedText style={styles.hintText}>
                      Use commas to create bubbles (e.g., Food, Networking, Live music).
                    </ThemedText>
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Image (optional)</ThemedText>
                    <TouchableOpacity
                      style={styles.imagePickerButton}
                      onPress={pickEditEventRequestImage}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.imagePickerButtonText}>
                        {editEventImage ? 'Change Image' : 'Choose from Camera Roll'}
                      </ThemedText>
                    </TouchableOpacity>
                    {editEventImage && (
                      <Image source={{ uri: editEventImage }} style={styles.imagePreview} resizeMode="cover" />
                    )}
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Admin notes</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Notes for the requester"
                      placeholderTextColor="#888888"
                      value={editEventAdminNotes}
                      onChangeText={setEditEventAdminNotes}
                      multiline
                      numberOfLines={3}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                    onPress={handleSaveEventRequest}
                    disabled={loading}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.submitButtonText}>Save Changes</ThemedText>
                    )}
                  </TouchableOpacity>
                  {selectedEventRequest?.id && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                      <TouchableOpacity
                        style={[styles.submitButton, styles.approveButton, { flex: 1 }]}
                        onPress={() => handleApproveEventRequest(selectedEventRequest.id)}
                        disabled={loading}>
                        <ThemedText style={styles.submitButtonText}>Approve (Post)</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.submitButton, styles.denyButton, { flex: 1 }]}
                        onPress={() => handleDenyEventRequest(selectedEventRequest.id)}
                        disabled={loading}>
                        <ThemedText style={styles.submitButtonText}>Deny</ThemedText>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          </Modal>

          {/* Edit Posted Event Modal */}
          <Modal
            visible={showEditPostedEventModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowEditPostedEventModal(false)}>
            <View style={styles.detailModalContainer}>
              <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                <TouchableOpacity onPress={() => setShowEditPostedEventModal(false)}>
                  <ThemedText style={styles.backButton}>←</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.detailHeaderTitle}>Edit Event</ThemedText>
                <View style={{ width: 40 }} />
              </View>
              <ScrollView
                style={styles.detailScrollView}
                contentContainerStyle={styles.detailContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                <View style={styles.detailEditForm}>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Event name *</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Event name"
                      placeholderTextColor="#888888"
                      value={editPostedEventName}
                      onChangeText={setEditPostedEventName}
                      maxLength={MAX_EVENT_NAME_LEN}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Location</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Where is it?"
                      placeholderTextColor="#888888"
                      value={editPostedEventLocation}
                      onChangeText={setEditPostedEventLocation}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Meeting time</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Fri 6pm, Room 101"
                      placeholderTextColor="#888888"
                      value={editPostedEventMeetingTime}
                      onChangeText={setEditPostedEventMeetingTime}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Description</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Describe the event"
                      placeholderTextColor="#888888"
                      value={editPostedEventDescription}
                      onChangeText={setEditPostedEventDescription}
                      multiline
                      numberOfLines={4}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Top qualities</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="e.g. Food, Networking, Live music"
                      placeholderTextColor="#888888"
                      value={editPostedEventTopQualities}
                      onChangeText={setEditPostedEventTopQualities}
                      multiline
                      numberOfLines={3}
                    />
                    <ThemedText style={styles.hintText}>
                      Use commas to create bubbles (e.g., Food, Networking, Live music).
                    </ThemedText>
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Image (optional)</ThemedText>
                    <TouchableOpacity
                      style={styles.imagePickerButton}
                      onPress={pickEditPostedEventImage}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.imagePickerButtonText}>
                        {editPostedEventImage ? 'Change Image' : 'Choose from Camera Roll'}
                      </ThemedText>
                    </TouchableOpacity>
                    {editPostedEventImage && (
                      <Image source={{ uri: editPostedEventImage }} style={styles.imagePreview} resizeMode="cover" />
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                    onPress={handleUpdatePostedEvent}
                    disabled={loading}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.submitButtonText}>Save Changes</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </Modal>

          {/* Create Event Modal */}
          <Modal
            visible={showCreateEventModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowCreateEventModal(false)}>
            <View style={styles.detailModalContainer}>
              <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                <TouchableOpacity onPress={() => setShowCreateEventModal(false)}>
                  <ThemedText style={styles.backButton}>←</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.detailHeaderTitle}>New Event</ThemedText>
                <View style={{ width: 40 }} />
              </View>
              <ScrollView
                style={styles.detailScrollView}
                contentContainerStyle={styles.detailContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                <View style={styles.detailEditForm}>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Event name *</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Event name"
                      placeholderTextColor="#888888"
                      value={newEventName}
                      onChangeText={setNewEventName}
                      maxLength={MAX_EVENT_NAME_LEN}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Location</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="Where is it?"
                      placeholderTextColor="#888888"
                      value={newEventLocation}
                      onChangeText={setNewEventLocation}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Meeting time</ThemedText>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Fri 6pm, Room 101"
                      placeholderTextColor="#888888"
                      value={newEventMeetingTime}
                      onChangeText={setNewEventMeetingTime}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Description</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Describe the event"
                      placeholderTextColor="#888888"
                      value={newEventDescription}
                      onChangeText={setNewEventDescription}
                      multiline
                      numberOfLines={4}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Top qualities</ThemedText>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="e.g. Food, Networking, Live music"
                      placeholderTextColor="#888888"
                      value={newEventTopQualities}
                      onChangeText={setNewEventTopQualities}
                      multiline
                      numberOfLines={3}
                    />
                    <ThemedText style={styles.hintText}>
                      Use commas to create bubbles (e.g., Food, Networking, Live music).
                    </ThemedText>
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemedText style={styles.label}>Image (optional)</ThemedText>
                    <TouchableOpacity
                      style={styles.imagePickerButton}
                      onPress={pickNewEventImage}
                      activeOpacity={0.7}>
                      <ThemedText style={styles.imagePickerButtonText}>
                        {newEventImage ? 'Change Image' : 'Choose from Camera Roll'}
                      </ThemedText>
                    </TouchableOpacity>
                    {newEventImage && (
                      <Image source={{ uri: newEventImage }} style={styles.imagePreview} resizeMode="cover" />
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                    onPress={handleCreateEvent}
                    disabled={loading}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.submitButtonText}>Create Event</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </Modal>
        </Animated.View>
      </ThemedView>
    );
  }

  // Manage members page
  if (currentPage === 'manage-members') {
    return (
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.pageContainer,
            {
              transform: [{ translateX: slideAnim }],
            },
          ]}>
          {renderPageHeader('Manage Members')}
          <View style={styles.searchBarWrap}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search members by name or email..."
              placeholderTextColor="#888888"
              value={memberSearch}
              onChangeText={setMemberSearch}
            />
          </View>
          <TouchableWithoutFeedback onPress={() => {
            setStatusMenuOpen(null);
            setMemberRoleMenuOpen(null);
          }}>
            <ScrollView
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + 20 },
              ]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }>
              {(memberSearch.trim() ? members.filter((m) => {
                const q = memberSearch.trim().toLowerCase();
                return (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
              }) : members).map((member, index) => (
                <View
                  key={`${member.id || 'member'}-${index}`}
                  style={[styles.requestCard, memberRoleMenuOpen === member.id && styles.memberCardMenuOpen]}
                >
                  <View style={styles.requestHeader}>
                    <TouchableOpacity
                      style={styles.memberInfo}
                      onPress={() => openEditMemberModal(member)}
                      activeOpacity={0.7}>
                      <View style={styles.memberAvatarContainer}>
                        {member.profile_pic ? (
                          <Image 
                            source={{ uri: member.profile_pic }} 
                            style={styles.memberAvatar}
                            defaultSource={require('@/assets/images/icon.png')}
                          />
                        ) : (
                          <View style={[styles.memberAvatar, styles.memberAvatarEmpty]}>
                            <ThemedText style={styles.memberAvatarText}>
                              {member.name.charAt(0).toUpperCase()}
                            </ThemedText>
                          </View>
                        )}
                      </View>
                      <View style={styles.memberTextInfo}>
                        <ThemedText style={styles.requestName}>{member.name}</ThemedText>
                        <ThemedText style={styles.memberEmail}>{member.email}</ThemedText>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.memberActions}>
                      <View style={styles.statusContainer}>
                        <TouchableOpacity
                          style={[
                            styles.statusBadge,
                            member.role === 'admin' && styles.statusApproved,
                          ]}
                          onPress={(e) => {
                            e.stopPropagation();
                            // Don't allow role change for self
                            if (member.id !== user?.user_id) {
                              setMemberRoleMenuOpen(memberRoleMenuOpen === member.id ? null : member.id);
                            }
                          }}
                          activeOpacity={member.id !== user?.user_id ? 0.7 : 1}>
                          <ThemedText style={styles.statusText}>
                            {member.role === 'admin' ? 'Admin' : 'Student'}
                          </ThemedText>
                        </TouchableOpacity>
                        {memberRoleMenuOpen === member.id && member.id !== user?.user_id && (
                          <View style={styles.statusMenu}>
                            <TouchableOpacity
                              style={[styles.statusMenuItem, member.role === 'admin' && styles.statusMenuItemActive]}
                              onPress={() => handleChangeMemberRole(member.id, 'admin')}>
                              <ThemedText style={styles.statusMenuItemText}>Admin</ThemedText>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.statusMenuItem, member.role === 'student' && styles.statusMenuItemActive]}
                              onPress={() => handleChangeMemberRole(member.id, 'student')}>
                              <ThemedText style={styles.statusMenuItemText}>Student</ThemedText>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                      {member.id !== user?.user_id && (
                        <TouchableOpacity
                          style={styles.deleteIconButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            handleDeleteMember(member.id, member.name, member.email);
                          }}
                          activeOpacity={0.7}>
                          <IconSymbol name="trash.fill" size={20} color="#FF6B6B" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              ))}

              {members.length === 0 && loading && (
                <View style={styles.emptyContainer}>
                  <ActivityIndicator size="large" color="#5FA8D3" />
                </View>
              )}
              {members.length === 0 && !loading && (
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>No members found</ThemedText>
                </View>
              )}
            </ScrollView>
          </TouchableWithoutFeedback>

          {/* Edit Member Modal */}
          <Modal
            visible={showEditMemberModal}
            animationType="slide"
            transparent={false}
            onRequestClose={() => setShowEditMemberModal(false)}>
            {selectedMember && (
              <View style={styles.detailModalContainer}>
                <View style={[styles.detailHeader, { paddingTop: insets.top + HEADER_SPACING }]}>
                  <TouchableOpacity onPress={() => setShowEditMemberModal(false)}>
                    <ThemedText style={styles.backButton}>←</ThemedText>
                  </TouchableOpacity>
                  <ThemedText style={styles.detailHeaderTitle}>
                    {selectedMember.id === user?.user_id ? 'Edit My Profile' : 'Edit Member'}
                  </ThemedText>
                  <View style={{ width: 40 }} />
                </View>

                <ScrollView
                  style={styles.detailScrollView}
                  contentContainerStyle={[
                    styles.detailContent,
                    { paddingBottom: insets.bottom + 40 },
                  ]}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled">
                  <View style={styles.detailEditForm}>
                    {/* Profile Picture */}
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Profile Picture</ThemedText>
                      <View style={styles.profilePicContainer}>
                        {editMemberProfilePic ? (
                          <Image 
                            source={{ uri: editMemberProfilePic }} 
                            style={styles.profilePicPreview}
                            defaultSource={require('@/assets/images/icon.png')}
                          />
                        ) : (
                          <View style={[styles.profilePicPreview, styles.profilePicPlaceholder]}>
                            <ThemedText style={styles.profilePicPlaceholderText}>
                              {selectedMember.name.charAt(0).toUpperCase()}
                            </ThemedText>
                          </View>
                        )}
                        <TouchableOpacity
                          style={styles.changePicButton}
                          onPress={pickEditMemberImage}
                          activeOpacity={0.7}>
                          <ThemedText style={styles.changePicButtonText}>
                            {editMemberProfilePic ? 'Change Picture' : 'Choose Picture'}
                          </ThemedText>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Name */}
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Name *</ThemedText>
                      <TextInput
                        style={styles.input}
                        placeholder="Member name"
                        placeholderTextColor="#888888"
                        value={editMemberName}
                        onChangeText={setEditMemberName}
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                        blurOnSubmit={true}
                      />
                    </View>

                    {/* Role - editable for other members, read-only for self */}
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Role</ThemedText>
                      {selectedMember.id === user?.user_id ? (
                        // Read-only for self
                        <View
                          style={[
                            styles.statusBadge,
                            selectedMember.role === 'admin' && styles.statusApproved,
                            { alignSelf: 'flex-start' },
                          ]}>
                          <ThemedText style={styles.statusText}>
                            {selectedMember.role === 'admin' ? 'Admin' : 'Student'}
                          </ThemedText>
                        </View>
                      ) : (
                        // Editable for other members — elevate when menu open so dropdown appears above form
                        <View style={[styles.statusContainer, showEditMemberRoleMenu && { zIndex: 1100, elevation: 12 }]}>
                          <TouchableOpacity
                            style={[
                              styles.statusBadge,
                              editMemberRole === 'admin' && styles.statusApproved,
                              { alignSelf: 'flex-start' },
                            ]}
                            onPress={() => setShowEditMemberRoleMenu(!showEditMemberRoleMenu)}
                            activeOpacity={0.7}>
                            <ThemedText style={styles.statusText}>
                              {editMemberRole === 'admin' ? 'Admin' : 'Student'}
                            </ThemedText>
                          </TouchableOpacity>
                          {showEditMemberRoleMenu && (
                            <View style={styles.statusMenu}>
                              <TouchableOpacity
                                style={[
                                  styles.statusMenuItem,
                                  editMemberRole === 'admin' && styles.statusMenuItemActive,
                                ]}
                                onPress={() => {
                                  setEditMemberRole('admin');
                                  setShowEditMemberRoleMenu(false);
                                }}>
                                <ThemedText style={styles.statusMenuItemText}>Admin</ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.statusMenuItem,
                                  editMemberRole === 'student' && styles.statusMenuItemActive,
                                ]}
                                onPress={() => {
                                  setEditMemberRole('student');
                                  setShowEditMemberRoleMenu(false);
                                }}>
                                <ThemedText style={styles.statusMenuItemText}>Student</ThemedText>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Email (display only) */}
                    <View style={styles.inputGroup}>
                      <ThemedText style={styles.label}>Email</ThemedText>
                      <ThemedText style={styles.readOnlyField}>{selectedMember.email}</ThemedText>
                    </View>

                    <TouchableOpacity
                      style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                      onPress={handleUpdateMember}
                      disabled={loading}>
                      {loading ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <ThemedText style={styles.submitButtonText}>Save Changes</ThemedText>
                      )}
                    </TouchableOpacity>

                    {/* Remove Member Button - only show for other members */}
                    {selectedMember.id !== user?.user_id && (
                      <TouchableOpacity
                        style={[styles.submitButton, styles.deleteButton, { marginTop: 12 }]}
                        onPress={() => {
                          setShowEditMemberModal(false);
                          handleDeleteMember(selectedMember.id, selectedMember.name, selectedMember.email);
                        }}>
                        <ThemedText style={styles.submitButtonText}>Remove Member</ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                </ScrollView>
              </View>
            )}
          </Modal>
        </Animated.View>
      </ThemedView>
    );
  }

  return null;
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
  },
  scrollContent: {
    padding: 16,
    paddingTop: 30,
    paddingBottom: 40,
    alignItems: 'center',
  },
  header: {
    marginBottom: 0,
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8B7355',
  },
  form: {
    gap: 12,
    width: '100%',
    maxWidth: 380,
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5FA8D3',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hintText: {
    fontSize: 12,
    color: '#8B7355',
    marginTop: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  pill: {
    backgroundColor: '#E8F2F8',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#BBD7EA',
  },
  pillText: {
    color: '#2E7BA6',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#2C3E50',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  levelButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  levelButtonActive: {
    backgroundColor: '#5FA8D3',
    borderColor: '#5FA8D3',
  },
  levelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
  },
  levelButtonTextActive: {
    color: '#FFFFFF',
  },
  submitButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#5FA8D3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitLocationButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerContainer: {
    paddingBottom: 18,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderBottomColor: '#E8D5C4',
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
  },
  listContent: {
    padding: 20,
    paddingTop: 16,
  },
  manageLocationsContent: {
    paddingTop: 24,
  },
  headerPlusButton: {
    padding: 4,
  },
  memberInfo: {
    flex: 1,
  },
  memberEmail: {
    fontSize: 14,
    color: '#8B7355',
    marginTop: 4,
  },
  memberAvatarContainer: {
    marginRight: 12,
    paddingBottom: 12,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#5FA8D3',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#E8D5C4',
  },
  memberAvatarEmpty: {
    backgroundColor: '#F8F8F8',
    borderWidth: 2,
    borderColor: '#5FA8D3',
  },
  memberAvatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#5FA8D3',
  },
  memberTextInfo: {
    flex: 1,
  },
  memberActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberCardMenuOpen: {
    zIndex: 1000,
    elevation: 10,
  },
  menuContainer: {
    flex: 1,
  },
  searchBarWrap: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
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
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#2C3E50',
  },
  pageContainer: {
    flex: 1,
  },
  profilePicContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  profilePicPreview: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#5FA8D3',
    marginBottom: 12,
    borderWidth: 3,
    borderColor: '#E8D5C4',
  },
  profilePicPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    overflow: 'hidden',
  },
  profilePicPlaceholderText: {
    fontSize: 48,
    fontWeight: '700',
    color: '#5FA8D3',
    lineHeight: 48,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  changePicButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  changePicButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  readOnlyField: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#8B7355',
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    shadowColor: '#5FA8D3',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  requestName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#E8D5C4',
  },
  statusSubmitted: {
    backgroundColor: '#5FA8D3',
  },
  statusApproved: {
    backgroundColor: '#4CAF50',
  },
  statusDenied: {
    backgroundColor: '#FF6B6B',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 12,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#E8D5C4',
    marginVertical: 16,
  },
  denyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  denyModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  denyModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  statusContainer: {
    position: 'relative',
    zIndex: 10,
  },
  statusMenu: {
    position: 'absolute',
    top: 35,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
    minWidth: 120,
    zIndex: 1000,
  },
  statusMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  statusMenuItemActive: {
    backgroundColor: '#F0F8FF',
  },
  statusMenuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
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
  adminNotes: {
    fontSize: 13,
    color: '#8B7355',
    fontStyle: 'italic',
    marginTop: 8,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#8B7355',
  },
  // Student request list styles
  myRequestsSection: {
    marginTop: 32,
    width: '100%',
    maxWidth: 380,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 16,
  },
  deleteIconButton: {
    padding: 4,
  },
  // Instagram-style detail modal styles
  detailModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    flexGrow: 1,
  },
  deleteButton: {
    backgroundColor: '#FF6B6B',
    shadowColor: '#FF6B6B',
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
  imagePickerButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  imagePickerButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  imagePreviewContainer: {
    marginTop: 8,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 8,
  },
  imagePreviewRow: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 8,
  },
  imagePreviewThumbWrap: {
    marginRight: 10,
  },
  imagePreviewThumb: {
    width: 140,
    height: 100,
    borderRadius: 10,
  },
  imagePreviewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  imagePreviewActionButton: {
    borderWidth: 1,
    borderColor: '#E8D5C4',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 6,
    backgroundColor: '#FFFFFF',
  },
  imagePreviewRemoveButton: {
    borderColor: '#FF6B6B',
  },
  imagePreviewActionText: {
    color: '#5FA8D3',
    fontSize: 12,
    fontWeight: '700',
  },
  announcementCardImage: {
    width: '100%',
    height: 120,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#F0F0F0',
  },
  announcementImagePreviewWrap: {
    marginTop: 8,
  },
  announcementImagePreview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    marginBottom: 8,
  },
  removeImageButton: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  removeImageButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  detailInfo: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  detailEditForm: {
    padding: 20,
  },
  detailInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailInfoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2C3E50',
    marginTop: 12,
    marginBottom: 4,
  },
  detailInfoText: {
    fontSize: 15,
    color: '#8B7355',
    marginBottom: 12,
  },
  detailEditHint: {
    fontSize: 13,
    color: '#6B7B8C',
    marginBottom: 14,
    fontStyle: 'italic',
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
  detailActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  detailActionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  detailActionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  placeholderText: {
    color: '#8B7355',
    fontSize: 16,
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
  // Menu styles
  menuContent: {
    padding: 16,
  },
  menuContentWithPadding: {
    paddingTop: 24,
  },
  menuItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    overflow: 'hidden',
  },
  menuItemButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
  },
  menuItemArrow: {
    fontSize: 24,
    color: '#8B7355',
    fontWeight: '300',
  },
  // Page header styles
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
    backgroundColor: '#FFFFFF',
  },
  backButtonContainer: {
    width: 40,
  },
  pageBackButton: {
    fontSize: 28,
    color: '#2C3E50',
    fontWeight: '300',
  },
  pageHeaderTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    textAlign: 'center',
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },




  orgImageButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    width: '100%',
    maxWidth: 360,
  },
  
  orgImageButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  orgChangeButton: {
    backgroundColor: '#5FA8D3',
  },
  
  orgRemoveButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FF6B6B',
  },
  
  orgImageButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  
  orgRemoveButtonText: {
    color: '#FF6B6B',
    fontSize: 15,
    fontWeight: '700',
  },
  
  // Note: placeholderText is already defined above
});



