# Optimized Ethereum Transaction Scanner

A blazing-fast Ethereum transaction scanner designed to discover and analyze contract creations from a specific sender. It leverages the Etherscan API (V2) for high-performance retrieval and provides deep analysis of every contract it finds.

## 🚀 Key Features

- **High Speed**: Uses Etherscan API V2 to fetch thousands of transactions in seconds, bypassing the need for slow, block-by-block RPC polling.
- **Isolate Sender Activity**: Automatically filters scans to focus on a specific sender address derived from a starting transaction hash.
- **Deep Contract Analysis**:
    - **Verification Check**: Instantly see if a created contract is verified on Etherscan.
    - **Advanced Proxy Detection**: 
        - Detects **EIP-1167** Minimal Proxies.
        - Identifies **EIP-1967** (Admin, Implementation, and Beacon slots).
        - Detects **EIP-1822** (UUPS) and **OpenZeppelin** legacy patterns.
- **Automated Proxy Linking**: Automatically triggers Etherscan's `verifyproxycontract` API to link proxies, enabling "Read/Write as Proxy" tabs without manual intervention.
- **Smart Metadata Retrieval**:
    - Fetches Implementation and Proxy Admin addresses.
    - Retrieves deployment transaction hashes for implementation and admin contracts.
    - Re-fetches implementation addresses after successful linking if they were previously unknown.

## 🛠️ Installation

1. Clone or download the repository.
2. Use the recommended Node.js version:
   ```bash
   nvm use
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Create a `.env` file and add your Etherscan API key for better rate limits:
   ```env
   ETHERSCAN_API_KEY=your_key_here
   ```

## 📖 Usage

Run the scanner by providing the network, a starting transaction hash, and an optional transaction limit.

```bash
node scanner.js <network> <startHash> [limit]
```

### Examples

**Scan recent activity on Sepolia:**
```bash
node scanner.js sepolia 0x4fe06cefa0326960d7bbbaf57748747caae29a4d50c4b7a6872f64c9b84103fb 50
```

**Scan activity on Ethereum Mainnet:**
```bash
node scanner.js ethmainnet 0x... 100
```

## 📊 Summary Output

After scanning, the tool provides a comprehensive summary of all created contracts:

```text
====================================================
           CREATED CONTRACTS SUMMARY
====================================================
1. Address: 0xbdb1875117bf55275fc540f430aeac417e87ba21
   Verification: ✅ Verified
   Proxy: Yes
   Implementation: 0x2a221532b684e4c15A83dbc5158aCb785BfDcC1F
   Implementation Hash: 0xe38c71b415150d27ac87bcc5998f7a805298d76a25d400744e8ad1a253dcc762
   Proxy Admin: 0xcA08497e1CfaE85D96A3ab8Cde6FBBC714A43F9A
   Proxy Admin Hash: 0x4fe06cefa0326960d7bbbaf57748747caae29a4d50c4b7a6872f64c9b84103fb
   Etherscan Linking: ✅ Success (Linked)
   Created at Block: 10189168
   Transaction: 0x4fe06cefa0326960d7bbbaf57748747caae29a4d50c4b7a6872f64c9b84103fb
```

## 🤝 Credits

This tool was developed with the expert assistance of **Antigravity**, an advanced agentic AI coding assistant from Google DeepMind.

## ⚖️ License

Distributed under the [MIT License](file:///Users/sriharsha/.gemini/antigravity/scratch/eth-tx-scanner/LICENSE).
