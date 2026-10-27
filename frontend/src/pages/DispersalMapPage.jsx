import { useCallback, useEffect, useState } from "react";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { useAutoRefresh } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { DispersalMap } from "../components/DispersalMap";
import { DispersalDialog } from "../components/DispersalDialog";
import { EmptyState } from "../components/EmptyState";
import { InlineAlert } from "../components/InlineAlert";
import { useAuth } from "../context/AuthContext";

/**
 * "Dispersal Map" — every geo-tagged beneficiary on one map, for the roles
 * with city-wide or field oversight (admin, doctor, technician).
 *
 * The trail a pin draws is the animal's OWNERSHIP CHAIN — where it came from
 * (CVO), which beneficiary received it, and each later handover, in date
 * order — read from the recorded ownership events rather than reconstructed
 * from field visits.
 *
 * Recording happens through the one shared DispersalDialog: this page opens it
 * from a pin's "Re-disperse" action, so a handover starts exactly where the
 * animal already is.
 */
export default function DispersalMapPage({ roleKey }) {
  const { user } = useAuth();
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // The shared dialog: `{ mode, beneficiary }` while open, null closed.
  const [dispersal, setDispersal] = useState(null);

  const role = roleKey ?? user?.role;
  const isTechnician = role === "technician";
  // Only the roles that may record a handover get the pin action
  // (manage_dispersal / manage_redispersal); a doctor's access is read-only.
  const canDisperse = role === "admin" || role === "technician";

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const rows = await beneficiariesApi.list({ per_page: 500 });
      setBeneficiaries(rows ?? []);
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so handovers registered elsewhere appear without a
  // manual reload.
  useAutoRefresh(load);

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Geo-Tagged Records</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Dispersal Map
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Every geo-tagged beneficiary in the program. Markers are colored by
              animal type; a full table view follows the map for accessibility.
              {canDisperse &&
                " Open a pin to show its flight path — the animal's recorded journey from CVO through each owner — or to re-disperse it."}
            </p>
          </div>
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {!error && notice && (
        <InlineAlert
          tone="success"
          message={notice}
          onDismiss={() => setNotice(null)}
          autoDismiss={5000}
        />
      )}

      <DispersalMap
        beneficiaries={beneficiaries}
        loading={loading}
        error={null}
        onRedisperse={
          canDisperse
            ? (beneficiary) => setDispersal({ mode: "re-disperse", beneficiary })
            : undefined
        }
      />

      {beneficiaries.length === 0 && !loading && !error && (
        <section className="card">
          <EmptyState
            title={
              isTechnician
                ? "No farmers assigned to you yet"
                : "Nothing to map yet"
            }
            description={
              isTechnician
                ? "You haven't been assigned any farmers. Contact an administrator to be assigned households to map."
                : "Geo-tagged beneficiaries appear here as soon as coordinates are captured in the field."
            }
          />
        </section>
      )}

      <DispersalDialog
        open={dispersal !== null}
        mode={dispersal?.mode ?? "re-disperse"}
        beneficiary={dispersal?.beneficiary ?? null}
        onClose={() => setDispersal(null)}
        onSaved={async () => {
          setNotice("Ownership recorded — the flight path now draws the recorded events.");
          await load();
        }}
      />
    </div>
  );
}
