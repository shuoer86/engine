import { Static, Type } from "@sinclair/typebox";
import { ethers, utils } from "ethers";
import { FastifyInstance } from "fastify";
import { StatusCodes } from "http-status-codes";
import {
  ERC20PermitAbi,
  ERC2771ContextAbi,
  ForwarderAbi,
  NativeMetaTransaction,
} from "../../../constants/relayer";
import { getRelayerById } from "../../../db/relayer/getRelayerById";
import { queueTx } from "../../../db/transactions/queueTx";
import { getSdk } from "../../../utils/cache/getSdk";
import {
  standardResponseSchema,
  transactionWritesResponseSchema,
} from "../../schemas/sharedApiSchemas";

const ParamsSchema = Type.Object({
  relayerId: Type.String(),
});

const BodySchema = Type.Union([
  Type.Object({
    type: Type.Literal("forward"),
    request: Type.Object({
      from: Type.String(),
      to: Type.String(),
      value: Type.String(),
      gas: Type.String(),
      nonce: Type.String(),
      data: Type.String(),
    }),
    signature: Type.String(),
    forwarderAddress: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("permit"),
    request: Type.Object({
      to: Type.String(),
      owner: Type.String(),
      spender: Type.String(),
      value: Type.String(),
      nonce: Type.String(),
      deadline: Type.String(),
    }),
    signature: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("execute-meta-transaction"),
    request: Type.Object({
      from: Type.String(),
      to: Type.String(),
      data: Type.String(),
    }),
    signature: Type.String(),
  }),
]);

const ReplySchema = Type.Composite([
  Type.Object({
    result: Type.Optional(
      Type.Object({
        queueId: Type.String({
          description: "Queue ID",
        }),
      }),
    ),
  }),
  Type.Object({
    error: Type.Optional(
      Type.Object({
        message: Type.String(),
      }),
    ),
  }),
]);

export async function relayTransaction(fastify: FastifyInstance) {
  fastify.route<{
    Params: Static<typeof ParamsSchema>;
    Reply: Static<typeof ReplySchema>;
    Body: Static<typeof BodySchema>;
  }>({
    method: "POST",
    url: "/relayer/:relayerId",
    schema: {
      summary: "Relay a meta-transaction",
      description: "Relay an EIP-2771 meta-transaction",
      tags: ["Relayer"],
      operationId: "relay",
      params: ParamsSchema,
      body: BodySchema,
      response: {
        ...standardResponseSchema,
        [StatusCodes.OK]: transactionWritesResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { relayerId } = req.params;

      const relayer = await getRelayerById({ id: relayerId });
      if (!relayer) {
        return res.status(400).send({
          error: {
            message: `No relayer found with id '${relayerId}'`,
          },
        });
      }

      const sdk = await getSdk({
        chainId: relayer.chainId,
        walletAddress: relayer.backendWalletAddress,
      });

      if (req.body.type === "execute-meta-transaction") {
        // Polygon Execute Meta Transaction
        const { request, signature } = req.body;
        const { v, r, s } = utils.splitSignature(signature);

        if (
          relayer.allowedContracts &&
          !relayer.allowedContracts.includes(request.to.toLowerCase())
        ) {
          return res.status(400).send({
            error: {
              message: `Requesting to relay transaction to unauthorized contract ${request.to}.`,
            },
          });
        }

        const target = await sdk.getContractFromAbi(
          request.to.toLowerCase(),
          NativeMetaTransaction,
        );

        const tx = await target.prepare("executeMetaTransaction", [
          request.from,
          request.data,
          r,
          s,
          v,
        ]);

        const queueId = await queueTx({
          tx,
          chainId: relayer.chainId,
          extension: "relayer",
        });

        res.status(200).send({
          result: {
            queueId,
          },
        });
        return;
      } else if (req.body.type === "permit") {
        // EIP-2612
        const { request, signature } = req.body;
        const { v, r, s } = utils.splitSignature(signature);

        // TODO: Remaining for backwards compatibility, but should enforce in the future
        if (
          relayer.allowedContracts &&
          !relayer.allowedContracts.includes(request.to.toLowerCase())
        ) {
          return res.status(400).send({
            error: {
              message: `Requesting to relay transaction to unauthorized contract ${request.to}.`,
            },
          });
        }

        const target = await sdk.getContractFromAbi(
          request.to.toLowerCase(),
          ERC20PermitAbi,
        );

        const tx = await target.prepare("permit", [
          request.owner,
          request.spender,
          request.value,
          request.deadline,
          v,
          r,
          s,
        ]);

        const queueId = await queueTx({
          tx,
          chainId: relayer.chainId,
          extension: "relayer",
        });

        res.status(200).send({
          result: {
            queueId,
          },
        });
        return;
      }

      // EIP-2771
      const { request, signature, forwarderAddress } = req.body;

      if (
        relayer.allowedForwarders &&
        !relayer.allowedForwarders.includes(forwarderAddress.toLowerCase())
      ) {
        return res.status(400).send({
          error: {
            message: `Requesting to relay transaction with unauthorized forwarder ${forwarderAddress}.`,
          },
        });
      }

      // TODO: Remaining for backwards compatibility, but should enforce in the future
      if (
        relayer.allowedContracts &&
        !relayer.allowedContracts.includes(request.to.toLowerCase())
      ) {
        return res.status(400).send({
          error: {
            message: `Requesting to relay transaction to unauthorized contract ${request.to}.`,
          },
        });
      }

      if (request.value !== "0") {
        return res.status(400).send({
          error: {
            message: `Requesting to relay transaction with non-zero value ${request.value}.`,
          },
        });
      }

      // EIP-2771
      const target = await sdk.getContractFromAbi(
        request.to.toLowerCase(),
        ERC2771ContextAbi,
      );

      const isTrustedForwarder = await target.call("isTrustedForwarder", [
        forwarderAddress,
      ]);
      if (!isTrustedForwarder) {
        res.status(400).send({
          error: {
            message: `Requesting to relay transaction with untrusted forwarder ${forwarderAddress}.`,
          },
        });
        return;
      }

      const forwarder = await sdk.getContractFromAbi(
        forwarderAddress,
        ForwarderAbi,
      );

      const valid = await forwarder.call("verify", [
        request,
        ethers.utils.joinSignature(ethers.utils.splitSignature(signature)),
      ]);

      if (!valid) {
        res.status(400).send({
          error: {
            message: "Verification failed with provided message and signature",
          },
        });
        return;
      }

      const tx = await forwarder.prepare("execute", [request, signature]);
      const queueId = await queueTx({
        tx,
        chainId: relayer.chainId,
        extension: "relayer",
      });

      res.status(200).send({
        result: {
          queueId,
        },
      });
    },
  });
}
