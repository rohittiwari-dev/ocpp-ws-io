import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { OCPPServer } from "../../server.js";
import type { OcppService } from "./ocpp.service.js";

export interface OcppRequest {
  ocppServer: OCPPServer;
  ocpp: OcppService;
}

@Injectable()
export class OcppMiddleware implements NestMiddleware {
  constructor(private readonly ocppService: OcppService) {}

  use(req: OcppRequest, _res: unknown, next: () => void): void {
    req.ocppServer = this.ocppService.server;
    req.ocpp = this.ocppService;
    next();
  }
}
