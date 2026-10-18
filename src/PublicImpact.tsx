import { useEffect, useState } from "react";
import * as S from "./store";

export default function PublicImpact({ id }: { id: string }) {
  const [d, setD] = useState<{ name: string; summary: ReturnType<typeof S.publicSummary> } | null>(null), [err, setErr] = useState("");
  useEffect(() => { S.publicSummary_(id).then(setD).catch(e => setErr((e as Error).message)); }, [id]);
  return (
    <div className="gate">
      <div className="gcard glass">
        <h1 className="brand">NEIGHBOURHOOD OS</h1>
        {err && <p className="errtext">{err}</p>}
        {!d && !err && <p className="dim">Loading…</p>}
        {d && (
          <>
            <h2>{d.name}</h2>
            <p className="dim">Community-reported figures. No names or locations are shown.</p>
            <div className="stats">
              <div className="red"><b>{d.summary.reports}</b>Reports</div><div className="green"><b>{d.summary.resolved}</b>Resolved</div><div className="amber"><b>{d.summary.avgHours || "–"}</b>Avg hours to fix</div>
            </div>
            <div className="stats">
              <div className="green"><b>{d.summary.volunteerHours}</b>Volunteer hours</div><div className="amber"><b>{d.summary.missionsDone}</b>Missions done</div><div className="red"><b>{d.summary.sosHelped + d.summary.sharesDone}</b>Neighbors helped</div>
            </div>
          </>
        )}
        <a className="dim" href="/">Open NEIGHBOURHOOD OS</a>
      </div>
    </div>
  );
}
