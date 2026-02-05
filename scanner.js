const { ethers } = require("ethers");
const fetch = require("node-fetch");
require("dotenv").config();

/**
 * Optimized Transaction Scanner
 * Uses Etherscan API to fetch transaction history much faster for a specific address.
 * Identifies contract creations and logs the resulting contract address.
 * 
 * Usage: node scanner.js <network> <startHash> <limit>
 */

// Configuration
const NETWORKS = {
    sepolia: {
        rpc: "https://ethereum-sepolia-rpc.publicnode.com",
        etherscanBase: "https://api.etherscan.io/v2/api",
        chainid: "11155111",
        name: "Sepolia"
    },
    ethmainnet: {
        rpc: "https://ethereum-rpc.publicnode.com",
        etherscanBase: "https://api.etherscan.io/v2/api",
        chainid: "1",
        name: "Ethereum Mainnet"
    }
};

const API_KEY = process.env.ETHERSCAN_API_KEY || "JDT195UTXBU7GYJ36PVVPE29PDR2AF5T4B"; // Etherscan works (slowly) without a key

const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920b3ca570ad306d";
const BEACON_SLOT = "0xa3f0ad74303ef594052300315d414dccea6a78378560244458f549733d314050";
const EIP1822_SLOT = "0xc1ea3cb31412d4d339023403d7d6789184583196ed0e160a4f5f9e8a5dc8f553";
const OZ_LEGACY_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";

async function getContractCreationHash(config, address) {
    if (API_KEY === "YourApiKeyToken") return null;
    try {
        const url = `${config.etherscanBase}?module=contract&action=getcontractcreation&contractaddresses=${address}&chainid=${config.chainid}&apikey=${API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === "1" && data.result && data.result[0]) {
            return data.result[0].txHash;
        }
    } catch (err) {}
    return null;
}

async function getContractABI(config, address) {
    if (API_KEY === "YourApiKeyToken") return null;
    try {
        const url = `${config.etherscanBase}?module=contract&action=getabi&address=${address}&chainid=${config.chainid}&apikey=${API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.status === "1") {
            return JSON.parse(data.result);
        }
    } catch (err) {}
    return null;
}

async function fetchParams(provider, address, abi) {
    if (!abi) return {};
    const params = {};
    const contract = new ethers.Contract(address, abi, provider);

    const skipFunctions = ["name", "symbol", "decimals", "owner", "implementation", "admin", "getProxyAdmin", "getImplementation"];

    const viewFunctions = abi.filter(item => 
        item.type === "function" && 
        (item.stateMutability === "view" || item.stateMutability === "pure") &&
        item.inputs.length === 0
    );

    for (const func of viewFunctions) {
        if (skipFunctions.includes(func.name)) continue;
        try {
            const result = await contract[func.name]();
            // Format the result
            if (typeof result === "bigint") {
                params[func.name] = result.toString();
            } else if (typeof result === "string" && ethers.isAddress(result)) {
                params[func.name] = result;
            } else if (Array.isArray(result)) {
                params[func.name] = result.map(v => typeof v === "bigint" ? v.toString() : v).join(", ");
            } else {
                params[func.name] = result.toString();
            }
        } catch (e) {
            // Silently skip if call fails
        }
    }
    return params;
}

async function verifyProxyOnEtherscan(config, proxyAddress, implementationAddress) {
    if (API_KEY === "YourApiKeyToken") return { success: false, message: "No API Key provided" };

    try {
        const params = new URLSearchParams({
            module: "contract",
            action: "verifyproxycontract",
            address: proxyAddress
        });

        if (implementationAddress) {
            params.append("expectedimplementation", implementationAddress);
        }

        // For Etherscan V2, routing parameters like chainid MUST be in the query string
        const url = `${config.etherscanBase}?chainid=${config.chainid}&apikey=${API_KEY}`;
        
        const response = await fetch(url, {
            method: 'POST',
            body: params
        });
        const data = await response.json();

        if (data.status === "1") {
            return { success: true, guid: data.result };
        } else {
            return { success: false, message: data.result || data.message };
        }
    } catch (err) {
        return { success: false, message: err.message };
    }
}

async function analyzeContract(provider, config, address) {
    const analysis = {
        verified: false,
        isProxy: false,
        implementation: null,
        implementationHash: null,
        contractOwner: null,
        contractOwnerHash: null,
        admin: null,
        adminHash: null,
        adminOwner: null,
        adminOwnerHash: null,
        beacon: null,
        proxyVerification: null,
        name: null,
        implementationName: null,
        params: {}
    };

    try {
        // 1. Check for EIP-1167 Minimal Proxy (clones)
        const code = await provider.getCode(address);
        if (code.startsWith("0x363d3d373d3d3d363d73") && code.length >= 90) {
            analysis.isProxy = true;
            analysis.implementation = ethers.getAddress("0x" + code.slice(22, 62));
        }

        // 2. Check Storage Slots via RPC
        const [adminRes, implRes, beaconRes, eip1822Res, ozLegacyRes] = await Promise.all([
            provider.getStorage(address, ADMIN_SLOT),
            provider.getStorage(address, IMPLEMENTATION_SLOT),
            provider.getStorage(address, BEACON_SLOT),
            provider.getStorage(address, EIP1822_SLOT),
            provider.getStorage(address, OZ_LEGACY_SLOT)
        ]);

        const formatAddress = (val) => {
            if (!val || val === ethers.ZeroHash || val === "0x") return null;
            const addr = ethers.getAddress("0x" + val.slice(-40));
            return addr === ethers.ZeroAddress ? null : addr;
        };

        const storageAdmin = formatAddress(adminRes);
        const storageImpl1967 = formatAddress(implRes);
        const storageBeacon = formatAddress(beaconRes);
        const storageImpl1822 = formatAddress(eip1822Res);
        const storageImplOZ = formatAddress(ozLegacyRes);

        if (storageAdmin) {
            analysis.admin = storageAdmin;
            analysis.isProxy = true;
        }
        
        if (storageBeacon) {
            analysis.beacon = storageBeacon;
            analysis.isProxy = true;
            try {
                const beaconContract = new ethers.Contract(storageBeacon, ["function implementation() view returns (address)"], provider);
                const beaconImpl = await beaconContract.implementation();
                if (beaconImpl && beaconImpl !== ethers.ZeroAddress) {
                    analysis.implementation = beaconImpl;
                }
            } catch (e) {}
        }
        
        const storageImpl = storageImpl1967 || storageImpl1822 || storageImplOZ;
        if (storageImpl) {
            analysis.implementation = storageImpl;
            analysis.isProxy = true;
        }

        // 3. Check Etherscan Source Code for Verification & Proxy flag
        const url = `${config.etherscanBase}?module=contract&action=getsourcecode&address=${address}&chainid=${config.chainid}${API_KEY !== "YourApiKeyToken" ? `&apikey=${API_KEY}` : ""}`;
        const response = await fetch(url);
        const data = await response.json();

        let etherscanFoundImpl = false;
        if (data.status === "1" && data.result && data.result[0]) {
            const info = data.result[0];
            analysis.verified = !!info.SourceCode;
            if (info.Proxy === "1") {
                analysis.isProxy = true;
                if (info.Implementation && info.Implementation !== ethers.ZeroAddress) {
                    etherscanFoundImpl = true;
                }
            }
            if (!analysis.implementation && info.Implementation && info.Implementation !== ethers.ZeroAddress) {
                analysis.implementation = ethers.getAddress(info.Implementation);
            }
            if (info.ContractName) {
                analysis.name = info.ContractName;
            }
        }

        // 3b. If implementation exists but we don't have its name, fetch it
        if (analysis.implementation) {
            try {
                const implUrl = `${config.etherscanBase}?module=contract&action=getsourcecode&address=${analysis.implementation}&chainid=${config.chainid}${API_KEY !== "YourApiKeyToken" ? `&apikey=${API_KEY}` : ""}`;
                const implResponse = await fetch(implUrl);
                const implData = await implResponse.json();
                if (implData.status === "1" && implData.result && implData.result[0]) {
                    analysis.implementationName = implData.result[0].ContractName || null;
                }
            } catch (e) {}
        }

        // 3c. Fetch Parameters (Automatic Data Discovery)
        const targetABI = await getContractABI(config, address);
        if (targetABI) {
            analysis.params = { ...analysis.params, ...(await fetchParams(provider, address, targetABI)) };
        }
        
        // If it's a proxy, also fetch params from implementation
        if (analysis.isProxy && analysis.implementation && analysis.implementation !== address) {
            const implABI = await getContractABI(config, analysis.implementation);
            if (implABI) {
                // Merge params, implementation might overwrite proxy storage state if viewed through proxy
                // But specifically we call it ON THE PROXY address but using implementation ABI if it's a proxy
                analysis.params = { ...analysis.params, ...(await fetchParams(provider, address, implABI)) };
            }
        }

        // 4. Secondary Data: Fetch creation hashes
        if (analysis.implementation) {
            analysis.implementationHash = await getContractCreationHash(config, analysis.implementation);
        }

        // 4b. General Ownership Check (on the contract itself)
        try {
            const contract = new ethers.Contract(address, ["function owner() view returns (address)"], provider);
            const owner = await contract.owner();
            if (owner && owner !== ethers.ZeroAddress) {
                analysis.contractOwner = owner;
                analysis.contractOwnerHash = await getContractCreationHash(config, owner);
            }
        } catch (e) {
            // Not ownable or call failed
        }

        if (analysis.admin) {
            analysis.adminHash = await getContractCreationHash(config, analysis.admin);
            
            // Check for Owner of ProxyAdmin
            try {
                const adminContract = new ethers.Contract(analysis.admin, ["function owner() view returns (address)"], provider);
                const owner = await adminContract.owner();
                if (owner && owner !== ethers.ZeroAddress) {
                    analysis.adminOwner = owner;
                    analysis.adminOwnerHash = await getContractCreationHash(config, owner);
                }
            } catch (e) {
                // Not ownable or call failed
            }
        }

        // 5. PRIMARY GOAL: Automatic Proxy Verification Trigger (Linking)
        // Only link if Etherscan hasn't already identified the implementation
        if (analysis.isProxy && !etherscanFoundImpl) {
            process.stdout.write("   Linking proxy on Etherscan...");
            const vResult = await verifyProxyOnEtherscan(config, address, analysis.implementation);
            analysis.proxyVerification = vResult;

            // 6. Post-Linking: Re-fetch implementation if it was missing
            if (vResult.success && !analysis.implementation) {
                try {
                    // Small delay to let Etherscan process
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const reCheckRes = await fetch(url);
                    const reCheckData = await reCheckRes.json();
                    if (reCheckData.status === "1" && reCheckData.result && reCheckData.result[0]) {
                        const newInfo = reCheckData.result[0];
                        if (newInfo.Implementation && newInfo.Implementation !== ethers.ZeroAddress) {
                            analysis.implementation = ethers.getAddress(newInfo.Implementation);
                            analysis.implementationHash = await getContractCreationHash(config, analysis.implementation);
                        }
                    }
                } catch (e) {}
            }
        }

    } catch (err) {
        console.error(`Analysis failed for ${address}:`, err.message);
    }

    return analysis;
}

async function scan(networkKey, startHash, limit = 1000) {
    const config = NETWORKS[networkKey.toLowerCase()];
    if (!config) {
        console.error(`Error: Unsupported network "${networkKey}". Use "sepolia" or "ethmainnet".`);
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(config.rpc);
    
    console.log(`\n--- Starting Optimized Scan on ${config.name} ---`);
    console.log(`Start Hash: ${startHash}`);
    console.log(`Scan Limit: ${limit} transactions (filtered by sender)\n`);

    // 1. Get details of the starting transaction
    console.log("Fetching starting transaction details...");
    const startTx = await provider.getTransaction(startHash);
    if (!startTx) {
        console.error("Error: Starting transaction hash not found.");
        return;
    }

    const startBlock = startTx.blockNumber;
    const sender = startTx.from;

    console.log(`Sender: ${sender}`);
    console.log(`Start Block: ${startBlock}`);
    console.log(`Fetching transaction list from Etherscan...`);

    // 2. Fetch transaction list from Etherscan
    const params = new URLSearchParams({
        chainid: config.chainid,
        module: "account",
        action: "txlist",
        address: sender,
        startblock: startBlock,
        sort: "asc"
    });

    if (API_KEY && API_KEY !== "YourApiKeyToken") {
        params.append("apikey", API_KEY);
    }

    const url = `${config.etherscanBase}?${params.toString()}`;
    
    // Debug: Log the URL (masking the API key)
    const maskedUrl = url.replace(/apikey=[^&]+/, "apikey=***");
    console.log(`Querying: ${maskedUrl}`);

    try {
        const response = await fetch(url);
        let data = await response.json();
        
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { console.error("Parse error:", data); return; }
        }

        if (data.status !== "1") {
            const errorMsg = data.message || "Unknown error";
            const errorDetail = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
            if (data.result === "No transactions found") {
                console.log("No transactions found for this sender in the specified block range.");
                return;
            }
            console.error(`Etherscan API Error: ${errorMsg} (${errorDetail})`);
            return;
        }

        const txs = data.result;
        if (!Array.isArray(txs)) {
            console.error("Expected data.result to be an array, but got:", typeof txs);
            return;
        }

        console.log(`Found ${txs.length} transactions from this sender starting block ${startBlock}.`);

        // 3. Filter to start from the target hash (inclusive)
        const startIndex = txs.findIndex(t => t.hash.toLowerCase() === startHash.toLowerCase());
        
        if (startIndex === -1) {
            console.log("Target hash not found in the transaction list fetched from Etherscan.");
            console.log("First few transaction hashes in the list:");
            txs.slice(0, 3).forEach((t, i) => console.log(`  [${i}] ${t.hash}`));
            return;
        }

        const remainingTxs = txs.slice(startIndex, startIndex + parseInt(limit));

        if (remainingTxs.length === 0) {
            console.log("No transactions found after the given hash.");
            return;
        }

        console.log(`Investigating ${remainingTxs.length} transactions in chronological order...\n`);

        const createdContracts = [];
        let count = 0;
        for (const tx of remainingTxs) {
            count++;
            const isCreation = !tx.to || tx.to === "" || tx.to === "0x0000000000000000000000000000000000000000";
            
            if (isCreation) {
                const contractAddr = tx.contractAddress || "Manual retrieval required";
                console.log(`[Tx #${count}] 🟢 CONTRACT CREATED: ${contractAddr}`);
                console.log(`   Hash: ${tx.hash}`);

                // Perform detailed analysis
                process.stdout.write("   Analyzing contract...");
                const analysis = await analyzeContract(provider, config, contractAddr);
                process.stdout.write(" Done.\n");

                createdContracts.push({
                    address: contractAddr,
                    deployer: tx.from,
                    hash: tx.hash,
                    block: tx.blockNumber,
                    ...analysis
                });
                console.log('----------------------------------------------------');
            }
        }

        console.log(`\nScan complete. Scanned ${count} transactions from sender.`);
        
        if (createdContracts.length > 0) {
            console.log("\n====================================================");
            console.log("           CREATED CONTRACTS SUMMARY");
            console.log("====================================================");
            createdContracts.forEach((c, i) => {
                const displayName = c.isProxy 
                    ? (c.implementationName ? `${c.implementationName} (Proxy: ${c.name || "Unknown"})` : (c.name || "Unknown Proxy"))
                    : (c.name || "Unknown Contract");
                
                console.log(`${i + 1}. Name: ${displayName}`);
                console.log(`   Address: ${c.address}`);
                console.log(`   Deployer: ${c.deployer}`);
                console.log(`   Verification: ${c.verified ? "✅ Verified" : "❌ Not Verified"}`);
                console.log(`   Proxy: ${c.isProxy ? "Yes" : "No"}`);
                if (c.contractOwner) {
                    console.log(`   Contract Owner: ${c.contractOwner}`);
                    if (c.contractOwnerHash) console.log(`   Contract Owner Hash: ${c.contractOwnerHash}`);
                }
                if (c.implementation) {
                    console.log(`   Implementation: ${c.implementation}`);
                    if (c.implementationName) console.log(`   Implementation Name: ${c.implementationName}`);
                    if (c.implementationHash) console.log(`   Implementation Hash: ${c.implementationHash}`);
                }
                if (c.beacon) console.log(`   Beacon: ${c.beacon}`);
                if (c.admin) {
                    console.log(`   Proxy Admin: ${c.admin}`);
                    if (c.adminHash) console.log(`   Proxy Admin Hash: ${c.adminHash}`);
                    if (c.adminOwner) {
                        console.log(`   Proxy Admin Owner: ${c.adminOwner}`);
                        if (c.adminOwnerHash) console.log(`   Proxy Admin Owner Hash: ${c.adminOwnerHash}`);
                    }
                }
                if (c.isProxy && c.proxyVerification) {
                    const v = c.proxyVerification;
                    console.log(`   Etherscan Linking: ${v.success ? "✅ Success (Linked)" : `❌ Failed (${v.message})`}`);
                }
                if (c.params && Object.keys(c.params).length > 0) {
                    console.log(`   Current Parameters:`);
                    for (const [key, val] of Object.entries(c.params)) {
                        console.log(`     - ${key}: ${val}`);
                    }
                }
                console.log(`   Created at Block: ${c.block}`);
                console.log(`   Transaction: ${c.hash}`);
                console.log("");
            });
        } else {
            console.log("\nNo contract creations found in the scanned range.");
        }

    } catch (err) {
        console.error("Failed to fetch from Etherscan:", err.message);
    }
}


const [,, network, hash, limitArg] = process.argv;

if (!network || !hash) {
    console.log("Usage: node scanner.js <sepolia|ethmainnet> <txHash> [limit]");
    process.exit(1);
}

scan(network, hash, limitArg ? limitArg : 1000).catch(err => {
    console.error("Fatal Error:", err);
});
