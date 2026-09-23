import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";

const ANIMAL_TYPES = ["Carabao", "Cattle", "Goat", "Swine", "Boar"];

// Barangays the program covers (Bayawan City, Negros Oriental) — mirrors
// config/cvo.php on the API. The pin resolves from the barangay name;
// GPS only fine-tunes it.
const BARANGAYS = [
  "Ali-Nan-Ban",
  "Banay Banay",
  "Cansumalig",
  "Daw-Kal-Vil",
  "Dawis",
  "Kalumboyan",
  "Tayawan",
];

/**
 * Field geo-tagging — the technician's primary screen.
 *
 * Registers a dispersed animal with its household and captures the GPS
 * position at the farm via expo-location, so the record appears on the
 * admin/doctor dispersal map. Calls the same `/api/v1/beneficiaries`
 * endpoint as the web app.
 */
export default function GeoTagScreen() {
  const [form, setForm] = useState({
    name_of_farmer: "",
    address: "", // barangay name from the coverage list
    animal_type: "Carabao",
    sex: "F",
  });
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const captureLocation = useCallback(async () => {
    setLocating(true);
    setError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission is required to geo-tag the farm.");
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setCoords({
        latitude: Number(position.coords.latitude.toFixed(7)),
        longitude: Number(position.coords.longitude.toFixed(7)),
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }, []);

  // Capture a GPS fix as soon as the screen opens — the technician is
  // already at the farm when they open it.
  useEffect(() => {
    captureLocation();
  }, [captureLocation]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.name_of_farmer.trim() || !form.address) {
      setError("Enter the farmer's name and pick the barangay.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      // GPS is an optional fine-tune — without it the server resolves the
      // pin from the barangay name alone.
      await beneficiariesApi.create({
        ...form,
        name_of_farmer: form.name_of_farmer.trim(),
        address: form.address.trim(),
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      });

      setNotice(
        coords
          ? "Beneficiary geo-tagged and saved."
          : "Beneficiary saved — pin placed at the barangay.",
      );
      setForm({ name_of_farmer: "", address: "", animal_type: "Carabao", sex: "F" });
      // Refresh the fix for the next farm visit.
      captureLocation();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Geo-tag a farm visit</Text>
        <Text style={styles.subtitle}>
          Register the dispersed animal and its household. The map pin is
          placed from the barangay; a GPS fix fine-tunes it to the exact farm.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <View style={styles.gpsCard}>
          <View style={styles.gpsRow}>
            <Text style={styles.gpsLabel}>GPS fine-tune (optional)</Text>
            {locating ? (
              <ActivityIndicator size="small" color="#558b2f" />
            ) : coords ? (
              <Text style={styles.gpsBadge}>Captured</Text>
            ) : null}
          </View>
          <Text style={styles.gpsValue}>
            {coords
              ? "Pin set to the exact farm position captured here."
              : "The pin falls back to the chosen barangay's location."}
          </Text>
          <TouchableOpacity style={styles.gpsButton} onPress={captureLocation} disabled={locating}>
            <Text style={styles.gpsButtonText}>
              {locating ? "Locating…" : coords ? "Re-capture location" : "Use my current location"}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Name of farmer</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Juan Dela Cruz"
          value={form.name_of_farmer}
          onChangeText={(value) => update("name_of_farmer", value)}
        />

        <Text style={styles.label}>Barangay</Text>
        <View style={styles.chipRow}>
          {BARANGAYS.map((barangay) => (
            <TouchableOpacity
              key={barangay}
              style={[styles.chip, form.address === barangay && styles.chipActive]}
              onPress={() => update("address", barangay)}
            >
              <Text
                style={[styles.chipText, form.address === barangay && styles.chipTextActive]}
              >
                {barangay}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Type of animal dispersed</Text>
        <View style={styles.chipRow}>
          {ANIMAL_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.chip, form.animal_type === type && styles.chipActive]}
              onPress={() => update("animal_type", type)}
            >
              <Text
                style={[
                  styles.chipText,
                  form.animal_type === type && styles.chipTextActive,
                ]}
              >
                {type}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Sex of animal</Text>
        <View style={styles.chipRow}>
          {[
            ["F", "Female (F)"],
            ["M", "Male (M)"],
          ].map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[styles.chip, form.sex === value && styles.chipActive]}
              onPress={() => update("sex", value)}
            >
              <Text style={[styles.chipText, form.sex === value && styles.chipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.submit, saving && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Save geo-tagged beneficiary</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  subtitle: { color: "#64748b", marginTop: 4, marginBottom: 16 },
  error: {
    color: "#dc2626",
    backgroundColor: "#fee2e2",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  notice: {
    color: "#3f6b22",
    backgroundColor: "#e3f1d9",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  gpsCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginBottom: 16,
  },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  gpsLabel: { fontWeight: "600", color: "#0f172a" },
  gpsBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#3f6b22",
    backgroundColor: "#e3f1d9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
    textTransform: "uppercase",
  },
  gpsValue: { color: "#64748b", marginTop: 6, fontVariant: ["tabular-nums"] },
  gpsButton: {
    marginTop: 10,
    backgroundColor: "#558b2f",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  gpsButtonText: { color: "#fff", fontWeight: "600" },
  label: { fontWeight: "600", color: "#0f172a", marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#558b2f", borderColor: "#558b2f" },
  chipText: { color: "#334155", fontSize: 13 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  submit: {
    backgroundColor: "#558b2f",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontWeight: "700" },
});
