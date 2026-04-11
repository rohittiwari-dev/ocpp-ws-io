import { createBoard } from "../board.js";
import type { BoardOptions } from "../types.js";

/**
 * NestJS DynamicModule adapter.
 * Usage:
 *   import { BoardModule } from "ocpp-ws-board/nest";
 *   @Module({ imports: [BoardModule.register({ auth: { mode: "token", token: "secret" } })] })
 */
export class BoardModule {
  static register(options: BoardOptions) {
    const board = createBoard(options);

    return {
      module: BoardModule,
      providers: [
        { provide: "BOARD_APP", useValue: board.app },
        { provide: "BOARD_PLUGIN", useValue: board.plugin },
        { provide: "BOARD_STORE", useValue: board.store },
        { provide: "BOARD_CLEANUP", useValue: board.cleanup },
      ],
      exports: ["BOARD_APP", "BOARD_PLUGIN", "BOARD_STORE", "BOARD_CLEANUP"],
    };
  }
}
