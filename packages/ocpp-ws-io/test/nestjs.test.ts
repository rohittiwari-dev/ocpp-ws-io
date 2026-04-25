import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Injectable } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import http, { type Server as HttpServer } from "node:http";
import "reflect-metadata";
import { WebSocket, WebSocketServer } from "ws";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";
import {
  Context,
  Identity,
  MessageId,
  OcppAuth,
  OcppGateway,
  OcppMessageEvent,
  OcppModule,
  type OcppOptionsFactory,
  OcppService,
  OcppWildcardEvent,
  Params,
  Path,
  PathParam,
  Protocol,
  Session,
} from "../src/frameworks/nestjs/index.js";
import type { AuthContext } from "../src/index.js";

const getPort = (server: HttpServer): number => {
  const address = server.address();
  if (address && typeof address === "object") return address.port;
  return 0;
};

@OcppGateway("/api/v1/chargers/*")
@Injectable()
class TestGateway {
  connected = vi.fn();

  onOcppClientConnected() {
    this.connected();
  }

  @OcppAuth()
  async auth(@Context() ctx: AuthContext) {
    ctx.accept({ protocol: "ocpp1.6", session: { role: "admin" } });
  }

  @OcppMessageEvent("BootNotification")
  async handleBoot(
    @Identity() identity: string,
    @Params() params: any,
    @Session() session: any,
    @Path() path: string,
    @PathParam() pathParams: Record<string, string>,
    @Protocol() protocol: string,
    @MessageId() messageId: string,
  ) {
    return {
      status: "Accepted",
      currentTime: "2026-04-25T00:00:00.000Z",
      interval: 300,
      testIdentity: identity,
      testParams: params,
      testSession: session,
      testPath: path,
      testPathParams: pathParams,
      testProtocol: protocol,
      hasMessageId: typeof messageId === "string" && messageId.length > 0,
    };
  }

  @OcppWildcardEvent()
  async handleWildcard(@Identity() identity: string, @Context() ctx: any) {
    return {
      wildcardIdentity: identity,
      wildcardMethod: ctx.method,
    };
  }
}

class TestOptionsFactory implements OcppOptionsFactory {
  createOcppOptions() {
    return {
      protocols: ["ocpp1.6"],
      logging: false,
    };
  }
}

describe("NestJS OCPP Integration", () => {
  let module: TestingModule | undefined;
  let httpServer: HttpServer | undefined;
  let client: OCPPClient | undefined;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        OcppModule.forRoot({
          protocols: ["ocpp1.6"],
          logging: false,
        }),
      ],
      providers: [TestGateway],
    }).compile();

    await module.init();
    const ocpp = module.get(OcppService);
    httpServer = await ocpp.server.listen(0);
  });

  afterEach(async () => {
    if (client) {
      await client.close({ force: true }).catch(() => {});
      client = undefined;
    }
    if (module) {
      await module.close();
      module = undefined;
    }
    if (httpServer?.listening) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it("maps decorated gateway handlers and parameter decorators", async () => {
    const port = getPort(httpServer!);
    client = new OCPPClient({
      identity: "CP-NEST",
      endpoint: `ws://localhost:${port}/api/v1/chargers`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();

    const response = await client.call("BootNotification", {
      chargePointModel: "Model-N",
      chargePointVendor: "Vendor-N",
    });

    expect(response).toMatchObject({
      status: "Accepted",
      interval: 300,
      testIdentity: "CP-NEST",
      testParams: {
        chargePointModel: "Model-N",
        chargePointVendor: "Vendor-N",
      },
      testSession: { role: "admin" },
      testPath: "/api/v1/chargers/CP-NEST",
      testProtocol: "ocpp1.6",
      hasMessageId: true,
    });

    const gateway = module!.get(TestGateway);
    expect(gateway.connected).toHaveBeenCalledTimes(1);
  });

  it("exposes server and client control through OcppService", async () => {
    const ocpp = module!.get(OcppService);
    const port = getPort(httpServer!);

    client = new OCPPClient({
      identity: "CP-SERVICE",
      endpoint: `ws://localhost:${port}/api/v1/chargers`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    client.handle("Reset", ({ params }) => ({
      status: "Accepted",
      received: params,
    }));

    await client.connect();

    expect(ocpp.getClient("CP-SERVICE")?.identity).toBe("CP-SERVICE");
    expect(await ocpp.hasClient("CP-SERVICE")).toBe(true);

    const response = await ocpp.sendToClient("CP-SERVICE", "Reset", {
      type: "Soft",
    });

    expect(response).toEqual({
      status: "Accepted",
      received: { type: "Soft" },
    });
  });

  it("maps wildcard handlers with the method name", async () => {
    const port = getPort(httpServer!);
    client = new OCPPClient({
      identity: "CP-WILD",
      endpoint: `ws://localhost:${port}/api/v1/chargers`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });

    await client.connect();

    await expect(client.call("CustomAction", {})).resolves.toEqual({
      wildcardIdentity: "CP-WILD",
      wildcardMethod: "CustomAction",
    });
  });

  it("supports forRootAsync useClass", async () => {
    const asyncModule = await Test.createTestingModule({
      imports: [
        OcppModule.forRootAsync({
          useClass: TestOptionsFactory,
        }),
      ],
    }).compile();

    await asyncModule.init();
    const ocpp = asyncModule.get(OcppService);

    expect(ocpp.server).toBeInstanceOf(OCPPServer);

    await asyncModule.close();
  });

  it("does not consume non-OCPP upgrade requests when routes are known", async () => {
    const server = new OCPPServer({ logging: false });
    const nestHttpServer = http.createServer();
    const service = new OcppService(server, {}, {
      httpAdapter: {
        getHttpServer: () => nestHttpServer,
      },
    } as any);
    const otherWss = new WebSocketServer({ noServer: true });
    let otherUpgradeHandled = false;

    service.registerUpgradePath("/ocpp/*");
    nestHttpServer.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/socket.io")) return;
      otherUpgradeHandled = true;
      otherWss.handleUpgrade(req, socket, head, (ws) => {
        ws.close();
      });
    });
    service.onModuleInit();

    await new Promise<void>((resolve) => nestHttpServer.listen(0, resolve));

    const ws = new WebSocket(
      `ws://localhost:${getPort(nestHttpServer)}/socket.io`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    expect(otherUpgradeHandled).toBe(true);

    ws.close();
    otherWss.close();
    await service.onModuleDestroy();
    await new Promise<void>((resolve) => nestHttpServer.close(() => resolve()));
  });
});
