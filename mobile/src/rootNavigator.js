import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors, navigationTheme, stackScreenOptions } from "../theme";
import LoginScreen from "../screens/LoginScreen";
import ProjectsScreen from "../screens/ProjectsScreen";
import GeoTagScreen from "../screens/GeoTagScreen";

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { isAuthenticated, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={stackScreenOptions}>
        {isAuthenticated ? (
          <>
            <Stack.Screen
              name="GeoTag"
              component={GeoTagScreen}
              options={{ title: "CVO Field" }}
            />
            <Stack.Screen
              name="Projects"
              component={ProjectsScreen}
              options={{ title: "Projects" }}
            />
          </>
        ) : (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
