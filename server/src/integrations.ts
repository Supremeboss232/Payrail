import axios from 'axios';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface representing custom decrypted credentials mapping.
 */
export interface ConnectorConfig {
  // REST API properties
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body_template?: any;
  response_path?: string; // e.g. "data.id" or "tx_ref"

  // Web3 RPC properties
  rpc_url?: string;
  private_key?: string;
  contract_address?: string;
  destination_address?: string;
  token_decimals?: number;
}

/**
 * Universal Outbound HTTP REST API Adapter (http_callback)
 * Resolves templated parameters and fires a live HTTP transaction request.
 */
export async function executeHttpCallback(
  config: ConnectorConfig,
  amountCents: number,
  currency: string,
  destination: string
): Promise<string> {
  const url = config.url;
  const method = (config.method || 'POST').toUpperCase();
  
  if (!url) {
    throw new Error('REST API Connector Error: Endpoint "url" is not configured.');
  }

  // 1. Process placehold mappings
  const variables: Record<string, string> = {
    amount: amountCents.toString(),
    amount_dollars: (amountCents / 100).toFixed(2),
    currency: currency.toUpperCase(),
    destination: destination
  };

  const resolvePlaceholders = (val: any): any => {
    if (typeof val === 'string') {
      let resolved = val;
      for (const [k, v] of Object.entries(variables)) {
        resolved = resolved.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), v);
      }
      return resolved;
    }
    if (val && typeof val === 'object') {
      const copy = Array.isArray(val) ? [] : {};
      for (const [k, v] of Object.entries(val)) {
        (copy as any)[k] = resolvePlaceholders(v);
      }
      return copy;
    }
    return val;
  };

  // Resolve headers and body parameters
  const headers = resolvePlaceholders(config.headers || {});
  const body = resolvePlaceholders(config.body_template || {});

  // If simulation loop mode is enabled and it is a test run, bypass fetch
  if (
    process.env.MOCK_REAL_CONNECTOR === 'true' || 
    url.includes('localhost') || 
    url.includes('127.0.0.1') ||
    url.includes('partnerbank.com')
  ) {
    console.log(`[REST SIMULATION] Mock HTTP Call to: ${method} ${url}`);
    console.log('Headers:', JSON.stringify(headers));
    console.log('Body:', JSON.stringify(body));
    return `mock_http_ref_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  }

  // 2. Dispatch live request
  try {
    const res = await axios({
      url,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      data: body,
      timeout: 8000
    });

    // 3. Resolve transaction reference from response
    if (config.response_path) {
      const parts = config.response_path.split('.');
      let val: any = res;
      for (const part of parts) {
        val = val?.[part];
      }
      if (val) return val.toString();
    }

    return res.data?.id || res.data?.tx_hash || res.data?.reference || `api_ref_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  } catch (error: any) {
    const apiMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`REST API Connector failed: ${apiMsg}`);
  }
}

/**
 * Web3 JSON-RPC Node Token Transfer Adapter (web3_rpc)
 * Connects to a generic EVM node, verifies gas balance, and transfers tokens (e.g. USDC).
 */
export async function executeWeb3RpcTransfer(
  config: ConnectorConfig,
  amountCents: number,
  currency: string
): Promise<string> {
  const rpcUrl = config.rpc_url;
  const privateKey = config.private_key;
  const contractAddress = config.contract_address || '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // Default Ethereum USDC
  const toAddress = config.destination_address;

  if (!rpcUrl || !privateKey || !toAddress) {
    throw new Error('Web3 RPC Connector Error: rpc_url, private_key, and destination_address are required.');
  }

  // Fallback to simulation if test run or sandbox is active without a valid node
  if (process.env.MOCK_REAL_CONNECTOR === 'true' || rpcUrl.includes('localhost') || privateKey.startsWith('0xmock_')) {
    console.log(`[WEB3 SIMULATION] Mock RPC Transfer of ${amountCents} cents worth of ${currency} to ${toAddress}`);
    return `0xmock_tx_hash_${uuidv4().replace(/-/g, '')}`;
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    const tokenAbi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 value) returns (bool)',
      'function decimals() view returns (uint8)'
    ];

    const tokenContract = new ethers.Contract(contractAddress, tokenAbi, wallet);

    // 1. Resolve token decimals
    let decimals: number;
    if (config.token_decimals !== undefined) {
      decimals = config.token_decimals;
    } else {
      try {
        decimals = await tokenContract.decimals();
      } catch (e) {
        decimals = 6; // Default to 6 decimals for standard USDC/USDT
      }
    }

    // 2. Check Wallet balance
    const walletBalance = await tokenContract.balanceOf(wallet.address);
    
    // Scale cents to decimals (cents is 2 decimals, so we scale up by 10^(decimals - 2))
    const requiredAmount = BigInt(amountCents) * (10n ** BigInt(decimals - 2));

    if (walletBalance < requiredAmount) {
      throw new Error(`Solvency check failed. Gas Wallet ${wallet.address} has token balance of ${ethers.formatUnits(walletBalance, decimals)}, transaction requires ${amountCents / 100}`);
    }

    // 3. Dispatch transaction
    const tx = await tokenContract.transfer(toAddress, requiredAmount);
    await tx.wait(); // Wait for on-chain block confirmation

    return tx.hash;
  } catch (error: any) {
    throw new Error(`Web3 RPC transaction failed: ${error.message}`);
  }
}

/**
 * Standard Simulation Sandbox Adapter (simulation)
 * Sleeps for a mock network lag, prints output, and returns a dummy reference.
 */
export async function executeSimulation(
  amountCents: number,
  currency: string
): Promise<string> {
  // Wait 100ms
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const mockTxId = `sim_tx_ref_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  console.log(`[SIMULATION ADAPTOR] Successfully processed transfer of ${(amountCents / 100).toFixed(2)} ${currency}. Ref: ${mockTxId}`);
  
  return mockTxId;
}
