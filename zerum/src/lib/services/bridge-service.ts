/**
 * Estado da ponte para a UI. Nesta fase o executor é o NullFlowExecutor (sempre desligado): a "ponte" é só
 * o contrato visual (pílula, banner, modal). A fase futura troca `executor` por uma implementação real.
 */
import { NullFlowExecutor, type BridgeStatus, type FlowExecutor } from '../bridge/status';

let executor: FlowExecutor = new NullFlowExecutor();

/** Ponto de injeção da fase futura (e dos testes). */
export const setExecutor = (e: FlowExecutor): void => {
  executor = e;
};

export const getBridgeStatus = (): Promise<BridgeStatus> => executor.status();
export const getBridgeAccounts = () => executor.accounts();
