import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen name="login" options={{ title: 'Login', headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Register', headerShown: false }} />

      <Stack.Screen
        name="register-org"
        options={{
          title: 'Register Organization',
          headerShown: true,
          headerBackTitle: 'Login',
        }}
      />
    </Stack>
  );
}
