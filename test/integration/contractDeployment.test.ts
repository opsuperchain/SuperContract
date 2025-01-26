import { Wallet } from '../../src/wallet'
import { getXContract } from '../../src/contractFactory'
import { createPublicClient, http, parseEther, createWalletClient, Chain, Account } from 'viem'
import { describe, it, expect, beforeAll } from '@jest/globals'

// Test contract ABI and bytecode
const TEST_CONTRACT_ABI = [
  {
    type: 'function' as const,
    name: 'x',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view' as const
  },
  {
    type: 'function' as const,
    name: 'setX',
    inputs: [{ type: 'uint256', name: '_x' }],
    outputs: [],
    stateMutability: 'nonpayable' as const
  }
] as const;

// This is the compiled bytecode from our TestContract.sol
const TEST_CONTRACT_BYTECODE = '0x608060405234801561001057600080fd5b5060b18061001f6000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80630c55699c1460375780634018d9aa146051575b600080fd5b603f60005481565b60405190815260200160405180910390f35b6061605c3660046063565b600055565b005b600060208284031215607457600080fd5b503591905056fea264697066735822122016aefb46deda4932682978cf35aa73c8a486f9614d924bbd6cfaadc31cfed99864736f6c63430008130033' as `0x${string}`

describe('Contract Deployment Integration', () => {
  const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const ANVIL_CHAIN_ID = 31337
  const ANVIL_RPC_URL = 'http://localhost:8545'

  let isAnvilRunning = false
  let hasBalance = false
  let publicClient: ReturnType<typeof createPublicClient>
  let walletClient: ReturnType<typeof createWalletClient>
  let account: Account

  const anvilChain = {
    id: ANVIL_CHAIN_ID,
    name: 'Anvil',
    network: 'anvil',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [ANVIL_RPC_URL] },
      public: { http: [ANVIL_RPC_URL] },
    },
  } as const

  // Check if Anvil is running and account has balance
  beforeAll(async () => {
    try {
      publicClient = createPublicClient({
        chain: anvilChain,
        transport: http(ANVIL_RPC_URL)
      })

      const wallet = new Wallet(ANVIL_PRIVATE_KEY)
      account = wallet.getAccount()
      const balance = await publicClient.getBalance({ address: account.address })
      
      isAnvilRunning = true
      hasBalance = balance >= parseEther('1')

      // Create wallet client for direct deployment
      walletClient = createWalletClient({
        chain: anvilChain,
        transport: http(ANVIL_RPC_URL),
        account
      })
    } catch (error) {
      console.log('Anvil not running or other setup issue:', error)
    }
  })

  it('should deploy and interact with contract directly (without CREATE2)', async () => {
    // Skip if preconditions not met
    if (!isAnvilRunning) {
      console.log('Skipping test: Anvil not running')
      return
    }
    if (!hasBalance) {
      console.log('Skipping test: Test account has insufficient balance')
      return
    }

    // Deploy contract directly
    console.log('Deploying contract directly...')
    const hash = await walletClient.deployContract({
      abi: TEST_CONTRACT_ABI,
      bytecode: TEST_CONTRACT_BYTECODE,
      chain: anvilChain,
      account
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log('Direct deployment receipt:', receipt)

    expect(receipt.status).toBe('success')
    expect(receipt.contractAddress).toBeDefined()

    if (!receipt.contractAddress) {
      throw new Error('No contract address in receipt')
    }

    // Test contract interaction
    console.log('Testing contract interaction...')
    
    // Get initial value (should be 0)
    const initialValue = await publicClient.readContract({
      address: receipt.contractAddress,
      abi: TEST_CONTRACT_ABI,
      functionName: 'x',
    })

    console.log('Initial value:', initialValue?.toString())
    expect(initialValue).toBe(0n)

    // Set value to 42
    console.log('Setting value to 42...')
    const setHash = await walletClient.writeContract({
      address: receipt.contractAddress,
      abi: TEST_CONTRACT_ABI,
      functionName: 'setX',
      args: [42n],
      chain: anvilChain,
      account
    })

    const setReceipt = await publicClient.waitForTransactionReceipt({ hash: setHash })
    console.log('Set value receipt:', setReceipt)
    expect(setReceipt.status).toBe('success')

    // Get updated value (should be 42)
    const updatedValue = await publicClient.readContract({
      address: receipt.contractAddress,
      abi: TEST_CONTRACT_ABI,
      functionName: 'x',
    })

    console.log('Updated value:', updatedValue?.toString())
    expect(updatedValue).toBe(42n)
    console.log('Value successfully updated to 42')
  }, 30000)

  it('should deploy and interact with contract using CREATE2 factory', async () => {
    // Skip if preconditions not met
    if (!isAnvilRunning) {
      console.log('Skipping test: Anvil not running')
      return
    }
    if (!hasBalance) {
      console.log('Skipping test: Test account has insufficient balance')
      return
    }

    // Create wallet instance
    const wallet = new Wallet(ANVIL_PRIVATE_KEY)

    // Get contract wrapper with unique salt
    const uniqueSalt = `0x${Date.now().toString(16).padStart(64, '0')}` as `0x${string}`
    const contract = getXContract(
      ANVIL_CHAIN_ID,
      ANVIL_RPC_URL,
      wallet,
      TEST_CONTRACT_ABI,
      TEST_CONTRACT_BYTECODE,
      [],  // No constructor args
      uniqueSalt
    )

    // Deploy using CREATE2
    console.log('Deploying contract using CREATE2...')
    const { contractAddress, receipt } = await contract.deploy()
    console.log('CREATE2 deployment receipt:', receipt)

    expect(receipt.status).toBe('success')
    expect(contractAddress).toBeDefined()

    // Test contract interaction using wrapper
    console.log('Testing contract interaction...')
    const value = await contract.call('x')
    console.log('Retrieved value:', value?.toString())
    expect(value).toBe(0n)
    console.log('Contract interaction successful')

    // Verify the contract is at the computed address
    const isDeployed = await contract.isDeployed()
    expect(isDeployed).toBe(true)
    console.log('Contract verified at computed address')
  }, 30000)

  it('should set and read value using CREATE2 factory', async () => {
    // Skip if preconditions not met
    if (!isAnvilRunning) {
      console.log('Skipping test: Anvil not running')
      return
    }
    if (!hasBalance) {
      console.log('Skipping test: Test account has insufficient balance')
      return
    }

    // Create wallet instance
    const wallet = new Wallet(ANVIL_PRIVATE_KEY)

    // Get contract wrapper with unique salt
    const uniqueSalt = `0x${Date.now().toString(16).padStart(64, '0')}` as `0x${string}`
    const contract = getXContract(
      ANVIL_CHAIN_ID,
      ANVIL_RPC_URL,
      wallet,
      TEST_CONTRACT_ABI,
      TEST_CONTRACT_BYTECODE,
      [],  // No constructor args
      uniqueSalt
    )

    // Deploy using CREATE2
    console.log('Deploying contract using CREATE2...')
    const { contractAddress, receipt } = await contract.deploy()
    console.log('CREATE2 deployment receipt:', receipt)

    expect(receipt.status).toBe('success')
    expect(contractAddress).toBeDefined()

    // Get initial value (should be 0)
    console.log('Testing initial value...')
    const initialValue = await contract.call('x')
    console.log('Initial value:', initialValue?.toString())
    expect(initialValue).toBe(0n)

    // Set value to 42
    console.log('Setting value to 42...')
    const setReceipt = await contract.sendTx('setX', [42])
    console.log('Set value receipt:', setReceipt)
    expect(setReceipt.status).toBe('success')

    // Get updated value (should be 42)
    console.log('Testing updated value...')
    const updatedValue = await contract.call('x')
    console.log('Updated value:', updatedValue?.toString())
    expect(updatedValue).toBe(42n)
    console.log('Value successfully updated to 42')
  }, 30000)
}) 