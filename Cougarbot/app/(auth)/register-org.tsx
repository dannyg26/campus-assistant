import { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Keyboard,
  TouchableWithoutFeedback,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { apiService } from '@/services/api';

export default function RegisterOrgScreen() {
  const MAX_IMAGE_BYTES = 300_000;
  const [orgName, setOrgName] = useState('');
  const [orgDomains, setOrgDomains] = useState('');
  const [orgImage, setOrgImage] = useState<string | null>(null);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const insets = useSafeAreaInsets();
  const { authenticateWithTokens } = useAuth();

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

  const uploadImageIfNeeded = async (image: string | null) => {
    if (!image) return undefined;
    if (image.startsWith('data:')) {
      return await apiService.uploadBase64Image(image);
    }
    if (image.startsWith('http://') || image.startsWith('https://')) {
      return image;
    }
    Alert.alert('Image not ready', 'Please reselect the image.');
    return undefined;
  };

  const pickOrgImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.3,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const imageUri = getPickerAssetUri(result.assets[0]);
      if (imageUri) {
        setOrgImage(imageUri);
      }
    }
  };

  const handleRegisterOrg = async () => {
    if (!orgName.trim() || !adminName.trim() || !adminEmail.trim() || !adminPassword.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }
    if (adminPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    if (adminPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const domains = orgDomains
        .split(/[,;\n]/)
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      const uploadedLogo = await uploadImageIfNeeded(orgImage);

      const response = await apiService.registerOrganization({
        org_name: orgName.trim(),
        allowed_email_domains: domains.length ? domains : undefined,
        org_profile_pic: uploadedLogo,
        admin_name: adminName.trim(),
        admin_email: adminEmail.trim().toLowerCase(),
        admin_password: adminPassword,
      });

      await authenticateWithTokens(response.tokens, {
        email: adminEmail.trim(),
        name: adminName.trim(),
      });

      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('Registration Failed', error.response?.data?.detail || 'Could not create organization');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      {/* Stack header is shown for this route, so we only apply safe area on bottom/left/right */}
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <View style={styles.container}>
          <ScrollView
            // Prevent iOS from auto-insetting content under/around the native header
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scrollView}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingTop: 16,
                paddingBottom: insets.bottom + 40,
              },
            ]}
          >
            <View style={styles.content}>
              <View style={styles.headerContainer}>
                <ThemedText style={styles.title}>Register Organization</ThemedText>
                <ThemedText style={styles.subtitle}>
                  Create a new organization and become its admin
                </ThemedText>
              </View>

              <View style={styles.formContainer}>
                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Organization name *</ThemedText>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Organization name"
                      placeholderTextColor="#888888"
                      value={orgName}
                      onChangeText={setOrgName}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Allowed email domains</ThemedText>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. university.edu, student.edu"
                      placeholderTextColor="#888888"
                      value={orgDomains}
                      onChangeText={setOrgDomains}
                    />
                  </View>
                  <ThemedText style={styles.hintText}>Separate multiple domains with commas.</ThemedText>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Organization image</ThemedText>
                  {orgImage ? (
                    <View>
                      <Image source={{ uri: orgImage }} style={styles.orgImage} />
                      <TouchableOpacity
                        onPress={() => setOrgImage(null)}
                        style={styles.removeImageBtn}
                        activeOpacity={0.7}
                      >
                        <ThemedText style={styles.removeImageText}>Remove image</ThemedText>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.imageButton} onPress={pickOrgImage} activeOpacity={0.7}>
                      <ThemedText style={styles.imageButtonText}>Choose Image</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Admin name *</ThemedText>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Full name"
                      placeholderTextColor="#888888"
                      value={adminName}
                      onChangeText={setAdminName}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Admin email *</ThemedText>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="admin@university.edu"
                      placeholderTextColor="#888888"
                      value={adminEmail}
                      onChangeText={setAdminEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Admin password *</ThemedText>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor="#888888"
                      value={adminPassword}
                      onChangeText={setAdminPassword}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <ThemedText style={styles.label}>Confirm password *</ThemedText>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="Confirm password"
                      placeholderTextColor="#888888"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleRegisterOrg}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.buttonText}>Create Organization</ThemedText>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.back()} style={styles.linkButton} activeOpacity={0.7}>
                  <ThemedText style={styles.linkText}>Back to Sign In</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F8F8',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 32,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 8,
    paddingTop: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#8B7355',
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5FA8D3',
    marginBottom: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E8D5C4',
  },
  input: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: '#2C3E50',
    backgroundColor: 'transparent',
  },
  hintText: {
    fontSize: 12,
    color: '#8B7355',
    marginTop: 6,
  },
  imageButton: {
    backgroundColor: '#5FA8D3',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  imageButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  orgImage: {
    width: '100%',
    height: 160,
    borderRadius: 12,
  },
  removeImageBtn: {
    marginTop: 8,
  },
  removeImageText: {
    color: '#FF6B6B',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    color: '#8B7355',
    fontSize: 14,
  },
});
