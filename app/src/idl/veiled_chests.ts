export type VeiledChests = {
  address: string;
  metadata: {
    name: string;
    version: string;
    spec: string;
  };
  instructions: [
    {
      name: "initPlayChestGameCompDef";
      accounts: [
        { name: "payer"; isMut: true; isSigner: true },
        { name: "mxeAccount"; isMut: true; isSigner: false },
        { name: "compDefAccount"; isMut: true; isSigner: false },
        { name: "arciumProgram"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [];
    },
    {
      name: "initTreasury";
      accounts: [
        { name: "authority"; isMut: true; isSigner: true },
        { name: "treasury"; isMut: true; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [];
    },
    {
      name: "fundTreasury";
      accounts: [
        { name: "funder"; isMut: true; isSigner: true },
        { name: "treasury"; isMut: true; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [{ name: "amount"; type: "u64" }];
    },
    {
      name: "playChestGame";
      accounts: [
        { name: "player"; isMut: true; isSigner: true },
        { name: "gameAccount"; isMut: true; isSigner: false },
        { name: "treasury"; isMut: true; isSigner: false },
        { name: "signPdaAccount"; isMut: true; isSigner: false },
        { name: "mxeAccount"; isMut: false; isSigner: false },
        { name: "mempoolAccount"; isMut: true; isSigner: false },
        { name: "executingPool"; isMut: true; isSigner: false },
        { name: "computationAccount"; isMut: true; isSigner: false },
        { name: "compDefAccount"; isMut: false; isSigner: false },
        { name: "clusterAccount"; isMut: true; isSigner: false },
        { name: "poolAccount"; isMut: true; isSigner: false },
        { name: "clockAccount"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false },
        { name: "arciumProgram"; isMut: false; isSigner: false }
      ];
      args: [
        { name: "computationOffset"; type: "u64" },
        { name: "numChests"; type: "u8" },
        { name: "betAmount"; type: "u64" },
        { name: "playerChoice"; type: { array: ["u8", 32] } },
        { name: "pubKey"; type: { array: ["u8", 32] } },
        { name: "nonce"; type: "u128" }
      ];
    },
    {
      name: "playChestGameCallback";
      accounts: [
        { name: "player"; isMut: true; isSigner: false },
        { name: "gameAccount"; isMut: true; isSigner: false },
        { name: "treasury"; isMut: true; isSigner: false },
        { name: "clusterAccount"; isMut: false; isSigner: false },
        { name: "computationAccount"; isMut: false; isSigner: false },
        { name: "arciumProgram"; isMut: false; isSigner: false },
        { name: "compDefAccount"; isMut: false; isSigner: false },
        { name: "instructionsSysvar"; isMut: false; isSigner: false },
        { name: "systemProgram"; isMut: false; isSigner: false }
      ];
      args: [
        {
          name: "output";
          type: {
            defined: "SignedComputationOutputs<PlayChestGameOutput>";
          };
        }
      ];
    },
    {
      name: "cancelGame";
      accounts: [
        { name: "player"; isMut: true; isSigner: false },
        { name: "gameAccount"; isMut: true; isSigner: false }
      ];
      args: [];
    }
  ];
  accounts: [
    {
      name: "treasury";
      type: {
        kind: "struct";
        fields: [
          { name: "authority"; type: "publicKey" },
          { name: "bump"; type: "u8" }
        ];
      };
    },
    {
      name: "gameAccount";
      type: {
        kind: "struct";
        fields: [
          { name: "player"; type: "publicKey" },
          { name: "betAmount"; type: "u64" },
          { name: "numChests"; type: "u8" },
          { name: "status"; type: "u8" },
          { name: "createdAt"; type: "i64" },
          { name: "computationOffset"; type: "u64" },
          { name: "bump"; type: "u8" }
        ];
      };
    }
  ];
  events: [
    {
      name: "GameResultEvent";
      fields: [
        { name: "player"; type: "publicKey"; index: false },
        { name: "playerWon"; type: "bool"; index: false },
        { name: "winningChest"; type: "u8"; index: false },
        { name: "numChests"; type: "u8"; index: false },
        { name: "betAmount"; type: "u64"; index: false },
        { name: "payout"; type: "u64"; index: false }
      ];
    },
    {
      name: "GameCancelledEvent";
      fields: [
        { name: "player"; type: "publicKey"; index: false },
        { name: "betAmount"; type: "u64"; index: false }
      ];
    }
  ];
  errors: [
    { code: 6000; name: "AbortedComputation"; msg: "The computation was aborted" },
    { code: 6001; name: "ClusterNotSet"; msg: "Cluster not set" },
    { code: 6002; name: "InvalidChestCount"; msg: "Invalid chest count - must be 2-5" },
    { code: 6003; name: "BetTooSmall"; msg: "Bet amount too small - minimum 0.01 SOL" },
    { code: 6004; name: "GameAlreadyActive"; msg: "Player already has an active game" },
    { code: 6005; name: "GameNotPending"; msg: "Game is not in pending status" },
    { code: 6006; name: "GameNotTimedOut"; msg: "Game has not timed out yet" },
    { code: 6007; name: "Overflow"; msg: "Arithmetic overflow" },
    { code: 6008; name: "NotGamePlayer"; msg: "Not the game player" }
  ];
};

export const IDL: VeiledChests = {
  address: "DDA1LfvE1kM8h4CcyqX4278oCYyB7QAg693QREjfNsZS",
  metadata: {
    name: "veiled_chests",
    version: "0.1.0",
    spec: "0.1.0",
  },
  instructions: [
    {
      name: "initPlayChestGameCompDef",
      accounts: [
        { name: "payer", isMut: true, isSigner: true },
        { name: "mxeAccount", isMut: true, isSigner: false },
        { name: "compDefAccount", isMut: true, isSigner: false },
        { name: "arciumProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "initTreasury",
      accounts: [
        { name: "authority", isMut: true, isSigner: true },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "fundTreasury",
      accounts: [
        { name: "funder", isMut: true, isSigner: true },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
    {
      name: "playChestGame",
      accounts: [
        { name: "player", isMut: true, isSigner: true },
        { name: "gameAccount", isMut: true, isSigner: false },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "signPdaAccount", isMut: true, isSigner: false },
        { name: "mxeAccount", isMut: false, isSigner: false },
        { name: "mempoolAccount", isMut: true, isSigner: false },
        { name: "executingPool", isMut: true, isSigner: false },
        { name: "computationAccount", isMut: true, isSigner: false },
        { name: "compDefAccount", isMut: false, isSigner: false },
        { name: "clusterAccount", isMut: true, isSigner: false },
        { name: "poolAccount", isMut: true, isSigner: false },
        { name: "clockAccount", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
        { name: "arciumProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "computationOffset", type: "u64" },
        { name: "numChests", type: "u8" },
        { name: "betAmount", type: "u64" },
        { name: "playerChoice", type: { array: ["u8", 32] } },
        { name: "pubKey", type: { array: ["u8", 32] } },
        { name: "nonce", type: "u128" },
      ],
    },
    {
      name: "playChestGameCallback",
      accounts: [
        { name: "player", isMut: true, isSigner: false },
        { name: "gameAccount", isMut: true, isSigner: false },
        { name: "treasury", isMut: true, isSigner: false },
        { name: "clusterAccount", isMut: false, isSigner: false },
        { name: "computationAccount", isMut: false, isSigner: false },
        { name: "arciumProgram", isMut: false, isSigner: false },
        { name: "compDefAccount", isMut: false, isSigner: false },
        { name: "instructionsSysvar", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        {
          name: "output",
          type: {
            defined: "SignedComputationOutputs<PlayChestGameOutput>",
          },
        },
      ],
    },
    {
      name: "cancelGame",
      accounts: [
        { name: "player", isMut: true, isSigner: false },
        { name: "gameAccount", isMut: true, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "treasury",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "publicKey" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "gameAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "player", type: "publicKey" },
          { name: "betAmount", type: "u64" },
          { name: "numChests", type: "u8" },
          { name: "status", type: "u8" },
          { name: "createdAt", type: "i64" },
          { name: "computationOffset", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
  events: [
    {
      name: "GameResultEvent",
      fields: [
        { name: "player", type: "publicKey", index: false },
        { name: "playerWon", type: "bool", index: false },
        { name: "winningChest", type: "u8", index: false },
        { name: "numChests", type: "u8", index: false },
        { name: "betAmount", type: "u64", index: false },
        { name: "payout", type: "u64", index: false },
      ],
    },
    {
      name: "GameCancelledEvent",
      fields: [
        { name: "player", type: "publicKey", index: false },
        { name: "betAmount", type: "u64", index: false },
      ],
    },
  ],
  errors: [
    { code: 6000, name: "AbortedComputation", msg: "The computation was aborted" },
    { code: 6001, name: "ClusterNotSet", msg: "Cluster not set" },
    { code: 6002, name: "InvalidChestCount", msg: "Invalid chest count - must be 2-5" },
    { code: 6003, name: "BetTooSmall", msg: "Bet amount too small - minimum 0.01 SOL" },
    { code: 6004, name: "GameAlreadyActive", msg: "Player already has an active game" },
    { code: 6005, name: "GameNotPending", msg: "Game is not in pending status" },
    { code: 6006, name: "GameNotTimedOut", msg: "Game has not timed out yet" },
    { code: 6007, name: "Overflow", msg: "Arithmetic overflow" },
    { code: 6008, name: "NotGamePlayer", msg: "Not the game player" },
  ],
};
