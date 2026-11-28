import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { projectsApi } from "../api/projectsApi";
import { getErrorMessage } from "../api/client";
import { colors } from "../theme";

export default function ProjectsScreen() {
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const projects = await projectsApi.list();
      setProjects(projects ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await projectsApi.create({ name: name.trim() });
      setName("");
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function handleDelete(project) {
    Alert.alert("Delete project", `Delete "${project.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await projectsApi.remove(project.id);
          load();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Projects</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.welcome}>Signed in as {user?.email}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.createRow}>
        <TextInput
          style={styles.createInput}
          placeholder="New project name"
          value={name}
          onChangeText={setName}
          onSubmitEditing={handleCreate}
        />
        <TouchableOpacity style={styles.createButton} onPress={handleCreate}>
          <Text style={styles.createButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={projects}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardStatus}>{item.status}</Text>
            </View>
            {item.description ? (
              <Text style={styles.cardDescription}>{item.description}</Text>
            ) : null}
            <TouchableOpacity onPress={() => handleDelete(item)}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        onRefresh={() => {
          setRefreshing(true);
          load();
        }}
        refreshing={refreshing}
        ListEmptyComponent={
          <Text style={styles.empty}>No projects yet — add one above.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 60, backgroundColor: colors.background },
  center: { justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { fontSize: 24, fontWeight: "700", color: colors.brandDark },
  logout: { color: colors.error, fontWeight: "600" },
  welcome: { color: colors.textSecondary, marginBottom: 16 },
  error: {
    color: colors.error,
    backgroundColor: colors.errorSoft,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  createRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  createInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  createButton: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  createButtonText: { color: colors.textOnDark, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.textPrimary },
  cardStatus: {
    fontSize: 12,
    color: colors.brand,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  cardDescription: { color: colors.textSecondary, marginTop: 4 },
  deleteText: { color: colors.error, fontWeight: "600", marginTop: 8 },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: 24 },
});
