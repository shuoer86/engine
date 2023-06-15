import { FastifyInstance } from "fastify";
import { readContract } from "./contract/read/read";
import { writeToContract } from "./contract/write/write";
import { getContractExtensions } from "./contract/metadata/extensions";

import { checkTxStatus } from "./transaction/status";
import { getAllTx } from "./transaction/getAll";

// Extensions
import { erc20Routes } from "./contract/extensions/erc20/index";
import { erc721Routes } from "./contract/extensions/erc721";
import { erc1155Routes } from "./contract/extensions/erc1155";
import { prebuiltsRoutes } from "./deployer";
import { marketplaceV3Routes } from "./contract/extensions/marketplaceV3/index";

// Chain
import { getChainData } from "./network/get";
import { getAllChainData } from "./network/getAll";

// Contract Events
import { getAllEvents } from "./contract/events/getAllEvents";
import { getEvents } from "./contract/events/getEvents";

// Contract Roles
import { getRoles } from "./contract/roles/read/get";
import { getAllRoles } from "./contract/roles/read/getAll";
import { grantRole } from "./contract/roles/write/grant";
import { revokeRole } from "./contract/roles/write/revoke";

// Contract Metadata
import { extractEvents } from "./contract/metadata/events";
import { extractFunctions } from "./contract/metadata/functions";
import { getABI } from "./contract/metadata/abi";

export const apiRoutes = async (fastify: FastifyInstance) => {
  // Chains
  await fastify.register(getChainData);
  await fastify.register(getAllChainData);

  // generic
  await fastify.register(readContract);
  await fastify.register(writeToContract);

  // Contract Events
  await fastify.register(getAllEvents);
  await fastify.register(getEvents);

  // Contract Metadata
  await fastify.register(getABI);
  await fastify.register(extractEvents);
  await fastify.register(getContractExtensions);
  await fastify.register(extractFunctions);

  // Contract Roles
  await fastify.register(getRoles);
  await fastify.register(getAllRoles);
  await fastify.register(grantRole);
  await fastify.register(revokeRole);

  // deployer
  await fastify.register(prebuiltsRoutes);

  // transaction status
  await fastify.register(checkTxStatus);
  await fastify.register(getAllTx);

  // Extensions
  await fastify.register(erc20Routes);
  await fastify.register(erc721Routes);
  await fastify.register(erc1155Routes);
  await fastify.register(marketplaceV3Routes);
};
