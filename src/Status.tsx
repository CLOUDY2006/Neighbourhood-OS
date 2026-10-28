import * as S from "./store";
import type { Act } from "./ui";
import { Pulse } from "./Pulse";
import { Reports } from "./Reports";

export function Status({ st, app, act, demo }: { st: S.State; app: S.AppState; act: Act; demo: boolean }) {
  return (
    <>
      <Pulse st={st} app={app} act={act} demo={demo} />
      <h3>Report for councils and local offices</h3>
      <Reports st={st} app={app} act={act} />
    </>
  );
}