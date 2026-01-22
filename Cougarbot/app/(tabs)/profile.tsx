import { useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  View,
  TextInput,
  ActivityIndicator,
  Modal,
  Keyboard,
  TouchableWithoutFeedback,
  Image,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { apiService } from '@/services/api';

export default function ProfileScreen() {
  const MAX_IMAGE_BYTES = 800_000;
  const { logout, user, login, refreshUser } = useAuth();
  const router = useRouter();
  const [showEditName, setShowEditName] = useState(false);
  const [showEditProfilePic, setShowEditProfilePic] = useState(false);
  const [showViewProfilePic, setShowViewProfilePic] = useState(false);
  const [newName, setNewName] = useState(user?.name || '');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const getPickerAssetUri = (asset: ImagePicker.ImagePickerAsset) => {
    if (!asset) return '';
    if (asset.base64) {
      const approxBytes = Math.floor((asset.base64.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        Alert.alert('Image too large', 'Please choose a smaller image.');
        return '';
      }
      return `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
    }
    return asset.uri;
  };

  const handleLogout = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleChangeName = () => {
    setNewName(user?.name || '');
    setShowEditName(true);
  };

  const handleSaveName = async () => {
    if (!newName.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      await apiService.updateProfile({ name: newName.trim() });
      Alert.alert('Success', 'Name updated successfully');
      setShowEditName(false);
      // Refresh user data - we'll update the context manually for now
      if (user) {
        user.name = newName.trim();
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update name');
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
      aspect: [1, 1],
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

  const handleSaveProfilePic = async () => {
    if (!selectedImage) {
      Alert.alert('Error', 'Please select an image first');
      return;
    }

    setLoading(true);
    try {
      await apiService.updateProfile({ profile_pic: selectedImage });
      Alert.alert('Success', 'Profile picture updated successfully');
      setShowEditProfilePic(false);
      setSelectedImage(null);
      // Refresh user data
      if (user) {
        user.profile_pic = selectedImage;
      }
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update profile picture');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              // TODO: Implement API endpoint for deleting account
              // await apiService.deleteAccount();
              Alert.alert('Success', 'Account deleted successfully', [
                {
                  text: 'OK',
                  onPress: async () => {
                    await logout();
                    router.replace('/(auth)/login');
                  },
                },
              ]);
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to delete account');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    setRefreshing(false);
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <ThemedView style={styles.container}>
      <View style={styles.headerContainer}>
        <ThemedText type="title" style={styles.headerTitle}>
          Profile
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {user && (
          <View style={styles.userInfo}>
            <View style={styles.userInfoHeader}>
              <TouchableOpacity 
                style={styles.userAvatarContainer}
                onPress={() => {
                  setSelectedImage(user.profile_pic || null);
                  setShowEditProfilePic(true);
                }}
                activeOpacity={0.8}>
                {user.profile_pic ? (
                  <Image 
                    source={{ uri: user.profile_pic }} 
                    style={styles.userAvatar}
                    defaultSource={require('@/assets/images/icon.png')}
                  />
                ) : (
                  <View style={[styles.userAvatar, styles.userAvatarEmpty]}>
                    <ThemedText style={styles.userAvatarPlus}>+</ThemedText>
                  </View>
                )}
              </TouchableOpacity>
              <View style={styles.userDetails}>
                <ThemedText style={styles.userName}>{user.name}</ThemedText>
                <ThemedText style={styles.userEmail}>{user.email}</ThemedText>
                <ThemedText style={styles.userRole}>
                  {user.role === 'admin' ? 'Administrator' : 'Student'}
                </ThemedText>
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <TouchableOpacity style={styles.menuItem} onPress={handleChangeName}>
            <ThemedText style={styles.menuItemText}>Change Name</ThemedText>
            <ThemedText style={styles.menuItemArrow}>›</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <ThemedText style={[styles.menuItemText, styles.menuItemTextDanger]}>
              Sign Out
            </ThemedText>
            <ThemedText style={styles.menuItemArrow}>›</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger]} onPress={handleDeleteAccount}>
            <ThemedText style={[styles.menuItemText, styles.menuItemTextDanger]}>
              Delete Account
            </ThemedText>
            <ThemedText style={styles.menuItemArrow}>›</ThemedText>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Name Modal */}
      <Modal
        visible={showEditName}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditName(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <ThemedText style={styles.modalTitle}>Change Name</ThemedText>
                  <TouchableOpacity onPress={() => setShowEditName(false)}>
                    <ThemedText style={styles.modalClose}>✕</ThemedText>
                  </TouchableOpacity>
                </View>

                <ThemedText style={styles.modalLabel}>New Name</ThemedText>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Enter your name"
                  placeholderTextColor="#888888"
                  value={newName}
                  onChangeText={setNewName}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  blurOnSubmit={true}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => setShowEditName(false)}>
                    <ThemedText style={styles.modalButtonTextCancel}>Cancel</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={handleSaveName}
                    disabled={loading}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.modalButtonTextSave}>Save</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Profile Picture Modal */}
      <Modal
        visible={showEditProfilePic}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditProfilePic(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <ThemedText style={styles.modalTitle}>Change Profile Picture</ThemedText>
                  <TouchableOpacity onPress={() => {
                    setShowEditProfilePic(false);
                    setSelectedImage(null);
                    setLoading(false);
                  }}>
                    <ThemedText style={styles.modalClose}>✕</ThemedText>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.imagePickerButton}
                  onPress={pickImage}
                  disabled={loading}>
                  <ThemedText style={styles.imagePickerButtonText}>
                    Choose from Camera Roll
                  </ThemedText>
                </TouchableOpacity>

                {user?.profile_pic && (
                  <TouchableOpacity
                    style={[styles.imagePickerButton, styles.viewImageButton]}
                    onPress={() => {
                      setShowEditProfilePic(false);
                      setTimeout(() => {
                        setShowViewProfilePic(true);
                      }, 350);
                    }}
                    activeOpacity={0.8}>
                    <ThemedText style={styles.imagePickerButtonText}>
                      View Current Picture
                    </ThemedText>
                  </TouchableOpacity>
                )}

                {selectedImage && (
                  <View style={styles.profilePicPreview}>
                    <Image 
                      source={{ uri: selectedImage }} 
                      style={styles.profilePicPreviewImage}
                    />
                  </View>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => {
                      setShowEditProfilePic(false);
                      setSelectedImage(null);
                      setLoading(false);
                    }}>
                    <ThemedText style={styles.modalButtonTextCancel}>Cancel</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave, !selectedImage && styles.modalButtonDisabled]}
                    onPress={handleSaveProfilePic}
                    disabled={loading || !selectedImage}>
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.modalButtonTextSave}>Save</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* View Profile Picture Modal */}
      <Modal
        visible={showViewProfilePic}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowViewProfilePic(false)}>
        <TouchableWithoutFeedback onPress={() => setShowViewProfilePic(false)}>
          <View style={styles.viewImageOverlay}>
            <View style={styles.viewImageContainer}>
              {user?.profile_pic && (
                <TouchableWithoutFeedback>
                  <Image 
                    source={{ uri: user.profile_pic }} 
                    style={styles.viewImageFull}
                    resizeMode="contain"
                  />
                </TouchableWithoutFeedback>
              )}
              <TouchableOpacity
                style={styles.viewImageCloseButton}
                onPress={() => setShowViewProfilePic(false)}>
                <ThemedText style={styles.viewImageCloseText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
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
  headerContainer: {
    paddingTop: 90,
    paddingBottom: 16,
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
  content: {
    padding: 16,
    paddingTop: 16,
  },
  userInfo: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  userInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatarContainer: {
    marginRight: 16,
  },
  userAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#5FA8D3',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#E8D5C4',
  },
  userAvatarEmpty: {
    backgroundColor: '#F8F8F8',
    borderWidth: 2,
    borderColor: '#5FA8D3',
    borderStyle: 'dashed',
  },
  userAvatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  userAvatarPlus: {
    fontSize: 32,
    fontWeight: '300',
    color: '#5FA8D3',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
    color: '#2C3E50',
  },
  userEmail: {
    fontSize: 14,
    opacity: 0.7,
    color: '#8B7355',
    marginBottom: 4,
  },
  userRole: {
    fontSize: 12,
    color: '#5FA8D3',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D5C4',
  },
  menuItemDanger: {
    borderBottomWidth: 0,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2C3E50',
  },
  menuItemTextDanger: {
    color: '#FF6B6B',
  },
  menuItemArrow: {
    fontSize: 20,
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
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
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
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5FA8D3',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
    padding: 16,
    fontSize: 16,
    color: '#2C3E50',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#E8D5C4',
  },
  modalButtonSave: {
    backgroundColor: '#5FA8D3',
  },
  modalButtonTextCancel: {
    color: '#2C3E50',
    fontSize: 16,
    fontWeight: '700',
  },
  modalButtonTextSave: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  profilePicPreview: {
    marginTop: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  profilePicPreviewImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: '#E8D5C4',
  },
  imagePickerButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  imagePickerButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  modalButtonDisabled: {
    opacity: 0.5,
  },
  viewImageButton: {
    marginTop: 12,
  },
  viewImageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewImageContainer: {
    width: '90%',
    height: '70%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  viewImageFull: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  viewImageCloseButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewImageCloseText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '300',
  },
});
