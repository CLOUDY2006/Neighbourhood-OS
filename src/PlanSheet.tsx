import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { STATUS_LABEL, type Issue } from "./logic";
import type { actionPlan } from "./plan";
import { useT } from "./i18n";

type Plan = ReturnType<typeof actionPlan>;
const DAY = 864e5;
const date = (t: number, year = false) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
const dayLabel = (plan: Plan, day: number, year = false) => (day === 0 ? "Day 0 " : `Day ${day} `) + `(${date(plan.base + day * DAY, year)})`;
const box = (done: boolean | null) => <i className={`pl-box ${done === true ? "on" : done === false ? "" : "na"}`} aria-hidden="true" />;

/** The plan as a readable checklist on screen. Steps the app can check off by itself are ticked. */
export function PlanSummary({ plan }: { plan: Plan }) {
  const t = useT();
  const pct = plan.progress.total ? Math.round((plan.progress.done / plan.progress.total) * 100) : 0;
  return (
    <div className="plan">
      <p className="plan-goal"><b>{t("Done when")}:</b> {plan.goal}</p>
      <div className="plan-prog" role="img" aria-label={`${plan.progress.done} of ${plan.progress.total} steps done`}>
        <span><i style={{ width: `${pct}%` }} /></span>
        <small>{plan.progress.done} {t("of")} {plan.progress.total} {t("steps done")}</small>
      </div>
      {plan.phases.map(ph => (
        <section key={ph.title} className="plan-phase">
          <h4>{ph.title}</h4>
          <ul>
            {ph.steps.map((x, n) => (
              <li key={n} className={x.done ? "done" : ""}>
                {box(x.done)}
                <span>{x.text}<small className="dim"> {x.who} &middot; {dayLabel(plan, x.day)}</small></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <details className="fold">
        <summary>{t("Details to include in the complaint")}</summary>
        <ul className="plan-list">{plan.collect.map((x, n) => <li key={n}>{x}</li>)}</ul>
      </details>
      <details className="fold">
        <summary>{t("If there is no reply")}</summary>
        <ul className="plan-list">
          {plan.ladder.map((l, n) => <li key={n} className={l.done ? "done" : ""}>{t("After")} {l.afterDays} {t("days with no reply")}: {l.to}{l.date ? ` (${date(l.date)})` : ""}</li>)}
        </ul>
        <small className="dim">{t("The agent prepares each next draft. A person approves it before it is sent.")}</small>
      </details>
      <details className="fold">
        <summary>{t("Safety")}</summary>
        <ul className="plan-list">
          {plan.safetyDo.map((x, n) => <li key={`d${n}`}><b>{t("Do")}:</b> {x}</li>)}
          {plan.safetyDont.map((x, n) => <li key={`n${n}`}><b>{t("Do not")}:</b> {x.replace(/^Do not |^Never /, "")}</li>)}
        </ul>
      </details>
      {plan.watch.length > 0 && (
        <details className="fold">
          <summary>{t("Watch out for")}</summary>
          <ul className="plan-list">{plan.watch.map((x, n) => <li key={n}>{x}</li>)}</ul>
        </details>
      )}
      <small className="dim">{t("Needs")}: {plan.volunteers} {t("volunteers")} &middot; {plan.personHours} {t("person-hours")} ({t("estimate")}) &middot; {plan.timeline} ({t("estimate")}) &middot; {plan.materials.join(", ")}.</small>
    </div>
  );
}

/** Print the plan sheet on its own: the app is hidden while the browser's print window is open. */
export function printPlan() {
  const cls = "printing-plan", done = () => { document.body.classList.remove(cls); window.removeEventListener("afterprint", done); };
  document.body.classList.add(cls);
  window.addEventListener("afterprint", done);
  window.print();
}

/** The printable A4 action plan. Hidden on screen; shown when printing or saving as PDF. */
export function PlanSheet({ plan, issue: i, photo }: { plan: Plan; issue: Issue; photo?: ReactNode }) {
  const osm = `https://www.openstreetmap.org/?mlat=${i.lat.toFixed(6)}&mlon=${i.lng.toFixed(6)}#map=18/${i.lat.toFixed(6)}/${i.lng.toFixed(6)}`;
  const gmaps = `https://www.google.com/maps?q=${i.lat.toFixed(6)},${i.lng.toFixed(6)}`;
  const daysOpen = Math.max(0, Math.floor((plan.base - i.created) / DAY));
  const sheet = (
    <div id="plan-print" className="print-only pp">
      <header className="pp-head">
        <small>ACTION PLAN</small>
        <h1>{i.title}</h1>
        <p>{i.cat} &middot; {STATUS_LABEL[i.status]} &middot; {plan.priority.level === "resolved" ? "resolved" : `${plan.priority.level} priority (${plan.priority.score}/100)`}</p>
      </header>

      <table className="pp-facts">
        <tbody>
          <tr><th>Location</th><td>{i.lat.toFixed(5)}, {i.lng.toFixed(5)}<br />Map: {osm}<br />Google Maps: {gmaps}</td></tr>
          {plan.missionSpot && <tr><th>Volunteers meet at</th><td>{plan.missionSpot.lat.toFixed(5)}, {plan.missionSpot.lng.toFixed(5)}<br />Google Maps: https://www.google.com/maps?q={plan.missionSpot.lat.toFixed(6)},{plan.missionSpot.lng.toFixed(6)}</td></tr>}
          <tr><th>Reported</th><td>{date(i.created, true)} &middot; open for {daysOpen} day{daysOpen === 1 ? "" : "s"} &middot; confirmed by {i.reports} resident{i.reports === 1 ? "" : "s"}</td></tr>
          <tr><th>Department</th><td>{plan.department}<br />Channel: {plan.channel}</td></tr>
          <tr><th>Complaint reference</th><td>{plan.ref || (plan.sent ? "Sent. Reference number not written down yet." : "Not sent yet.")}</td></tr>
          <tr><th>Day 0 is</th><td>{date(plan.base, true)} {i.actionPlan ? "(the day the plan was approved)" : "(today; the plan is not approved yet)"}</td></tr>
        </tbody>
      </table>
      {photo && <div className="pp-photo">{photo}<small>Before photo</small></div>}

      <h2>The problem</h2>
      <p>{i.desc}</p>
      <p className="pp-goal"><b>Done when:</b> {plan.goal}</p>

      <h2>Step by step</h2>
      {plan.phases.map(ph => (
        <div key={ph.title} className="pp-phase">
          <h3>{ph.title} <small>{ph.goal}</small></h3>
          <table className="pp-steps">
            <tbody>
              {ph.steps.map((x, n) => (
                <tr key={n}>
                  <td className="pp-chk">{box(x.done)}</td>
                  <td>{x.text}</td>
                  <td className="pp-who">{x.who}</td>
                  <td className="pp-when">{dayLabel(plan, x.day, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="pp-keep">
        <h2>Details to include in the complaint</h2>
        <ul className="pp-list">{plan.collect.map((x, n) => <li key={n} className="pp-bx">{box(null)} {x}</li>)}</ul>
      </div>

      <h2>If there is no reply</h2>
      <table className="pp-steps">
        <tbody>
          {plan.ladder.map((l, n) => (
            <tr key={n}><td className="pp-chk">{box(l.done)}</td><td>After {l.afterDays} days with no reply, escalate to: {l.to}</td><td className="pp-when">{l.date ? date(l.date, true) : "counted from the day it is sent"}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="pp-note">The agent prepares each next draft. A person approves it before it is sent.</p>

      <div className="pp-cols">
        <div>
          <h2>Safety</h2>
          <ul className="pp-list">
            {plan.safetyDo.map((x, n) => <li key={`d${n}`}><b>Do:</b> {x}</li>)}
            {plan.safetyDont.map((x, n) => <li key={`n${n}`}><b>Do not:</b> {x.replace(/^Do not |^Never /, "")}</li>)}
          </ul>
        </div>
        <div>
          <h2>Resources <small>(estimates)</small></h2>
          <ul className="pp-list">
            <li>{plan.volunteers} volunteer{plan.volunteers === 1 ? "" : "s"}</li>
            <li>About {plan.personHours} person-hours</li>
            <li>Time: {plan.timeline}</li>
            <li>Bring: {plan.materials.join(", ")}</li>
          </ul>
        </div>
      </div>

      {plan.watch.length > 0 && (<><h2>Watch out for</h2><ul className="pp-list">{plan.watch.map((x, n) => <li key={n}>{x}</li>)}</ul></>)}

      <h2>Why this priority</h2>
      <p>{plan.priority.reasons.map(x => `${x.label} (+${x.pts})`).join("; ")}. A fixed set of rules adds these points. It only sorts the list; a coordinator decides.</p>

      <h2>Notes</h2>
      <div className="pp-lines"><i /><i /><i /></div>

      <footer className="pp-sign">
        <div><span>Approved by (coordinator)</span><b>{i.actionPlan?.approvedBy ?? ""}</b></div>
        <div><span>Date</span><b>{i.actionPlan ? date(i.actionPlan.approvedAt, true) : ""}</b></div>
        <div><span>Signature</span><b /></div>
      </footer>
      <p className="pp-note">Suggested by NEIGHBOURHOOD OS from fixed rules. Estimates are marked. A coordinator must approve this plan before any action is taken. The app never files a complaint by itself; a person sends it.</p>
    </div>
  );
  // In the browser, mount the sheet next to the app so printing it never prints the app's empty pages.
  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}