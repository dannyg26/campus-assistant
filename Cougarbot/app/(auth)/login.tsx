import { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { apiService } from '@/services/api';

export default function LoginScreen() {
  const [orgId, setOrgId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [universities, setUniversities] = useState<string[]>([]);
  const [showUniversityList, setShowUniversityList] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const { login } = useAuth();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadUniversities();
  }, []);

  const loadUniversities = async () => {
    try {
      const orgs = await apiService.getOrganizations();
      const orgList = Array.isArray(orgs) ? orgs : orgs?.data || orgs?.orgs || [];
      const orgNames = orgList
        .map((org: any) => org.name || org.id || org)
        .filter(Boolean);

      if (orgNames.length > 0) {
        setUniversities(orgNames);
      } else {
        setUniversities(['outlook', 'outlook.com']);
      }
    } catch (error: any) {
      // Don't use fallback - show error to user
      Alert.alert(
        'Connection Error',
        'Could not connect to server. Make sure:\n\n1. Backend is running: python -m uvicorn main:app --reload --host 0.0.0.0\n2. Phone and laptop are on same WiFi\n3. Firewall allows port 8000\n\nCheck console for details.',
        [{ text: 'OK' }]
      );
      // Only use fallback if we're sure it's a network issue
      setUniversities([]);
    }
  };

  const filteredUniversities = universities.filter((uni) =>
    uni.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleLogin = async () => {
    if (!orgId.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await login(orgId.trim(), email.trim().toLowerCase(), password);
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const selectUniversity = (uni: string) => {
    setOrgId(uni);
    setShowUniversityList(false);
    setSearchTerm('');
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 },
          ]}
          style={styles.scrollView}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bounces={true}
          alwaysBounceVertical={true}
          scrollEnabled={true}
        >
        <View style={styles.content}>
          <View style={styles.headerContainer}>
            <ThemedText style={styles.title} numberOfLines={2}>
              Campus AI Assistant
            </ThemedText>
            <ThemedText style={styles.subtitle}>
              Personal AI Powered University Assistant
            </ThemedText>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>University</ThemedText>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="University Name"
                  placeholderTextColor="#888888"
                  value={orgId}
                  onChangeText={(text) => {
                    setOrgId(text);
                    setSearchTerm(text);

                    const hasMatches =
                      text.length > 0 &&
                      universities.some((u) =>
                        u.toLowerCase().includes(text.toLowerCase())
                      );

                    setShowUniversityList(hasMatches);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => {
                    if (orgId && filteredUniversities.length > 0) {
                      setShowUniversityList(true);
                    }
                  }}
                  onBlur={() => {
                    // On web, use longer delay to allow dropdown clicks
                    const delay = Platform.OS === 'web' ? 300 : 150;
                    setTimeout(() => {
                      setShowUniversityList(false);
                    }, delay);
                  }}
                  returnKeyType="next"
                  blurOnSubmit={false}
                />
              </View>

              {showUniversityList && filteredUniversities.length > 0 && (
                <View style={styles.dropdownContainer}>
                  <ScrollView
                    style={styles.dropdownScroll}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    {filteredUniversities.slice(0, 8).map((item, index) => (
                      <TouchableOpacity
                        key={item}
                        style={[
                          styles.dropdownItem,
                          index === filteredUniversities.slice(0, 8).length - 1 &&
                            styles.dropdownItemLast,
                        ]}
                        onPress={() => {
                          selectUniversity(item);
                          setShowUniversityList(false);
                        }}
                        activeOpacity={0.7}
                      >
                        <ThemedText style={styles.dropdownText}>{item}</ThemedText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Email</ThemedText>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="student@university.edu"
                  placeholderTextColor="#888888"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  blurOnSubmit={false}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Password</ThemedText>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#888888"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  blurOnSubmit={true}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText style={styles.buttonText}>Sign In</ThemedText>
              )}
            </TouchableOpacity>

            <View style={styles.linkContainer}>
              <ThemedText style={styles.linkText}>Don't have an account?</ThemedText>
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => router.push('/(auth)/register')}
                activeOpacity={0.7}
              >
                <ThemedText style={styles.linkTextBold}>Create one</ThemedText>
              </TouchableOpacity>
            </View>

            <View style={styles.linkContainer}>
              <ThemedText style={styles.linkText}>Want to add your organization?</ThemedText>
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => router.push('/(auth)/register-org')}
                activeOpacity={0.7}
              >
                <ThemedText style={styles.linkTextBold}>Register organization</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea} />
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F8F8',
  },
  safeArea: {
    flex: 1,
  },
  bottomSafeArea: {
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
    marginBottom: 48,
    marginTop: 20,
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 12,
    letterSpacing: -0.5,
    textAlign: 'center',
    lineHeight: 48,
  },
  subtitle: {
    fontSize: 16,
    color: '#8B7355',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '400',
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 18,
    position: 'relative',
    zIndex: 1,
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

  // Inline dropdown (no absolute positioning -> no overlap/clipping issues)
  dropdownContainer: {
    marginTop: 8,
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#87CEEB',
    overflow: 'hidden',
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownItem: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#87CEEB',
  },
  dropdownItemLast: {
    borderBottomWidth: 0,
  },
  dropdownText: {
    fontSize: 16,
    color: '#FFFFFF',
  },

  button: {
    backgroundColor: '#5FA8D3',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: '#5FA8D3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  linkContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 15,
    color: '#8B7355',
    marginBottom: 4,
  },
  linkButton: {
    paddingVertical: 4,
  },
  linkTextBold: {
    fontWeight: '700',
    color: '#5FA8D3',
    fontSize: 15,
  },
});
