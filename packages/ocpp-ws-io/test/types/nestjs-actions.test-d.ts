import { OcppMessageEvent } from "../../src/frameworks/nestjs/decorators/method.decorators.js";
import { unchecked } from "../../src/unchecked.js";

/**
 * T3c: @OcppMessageEvent names an action that exists, in the protocol given
 * when one is. A misspelt action registered a handler nothing ever called.
 * Compiled by `typecheck`; never run.
 */
export function messageEventActions() {
  OcppMessageEvent("BootNotification");
  OcppMessageEvent("BootNotification", "ocpp1.6");
  OcppMessageEvent("TransactionEvent", "ocpp2.0.1");
  OcppMessageEvent("NotifyPeriodicEventStream", "ocpp2.1");

  // @ts-expect-error no such action in any version
  OcppMessageEvent("BootNotifcation");
  // @ts-expect-error TransactionEvent is 2.0.1 and 2.1, not 1.6
  OcppMessageEvent("TransactionEvent", "ocpp1.6");
  // @ts-expect-error not a protocol
  OcppMessageEvent("BootNotification", "ocpp16");

  // Actions the types do not know.
  OcppMessageEvent(unchecked("VendorPing"));
  OcppMessageEvent(unchecked("VendorPing"), "vendor-proto");
}
