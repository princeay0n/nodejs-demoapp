import fs from 'node:fs/promises'

const VAULT_URL = 'https://kv-prince-dev-141665.vault.azure.net'
const SECRET_NAME = 'mongodb-app-password'
const MONGO_HOST = '10.230.4.4'
const MONGO_CA_FILE = '/etc/mongodb-certs/mongo-ca.crt'

async function getMongoPassword() {
  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  const tokenFile = process.env.AZURE_FEDERATED_TOKEN_FILE

  if (!tenantId || !clientId || !tokenFile) {
    throw new Error('Azure Workload Identity is not configured')
  }

  const assertion = await fs.readFile(tokenFile, 'utf8')

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: 'https://vault.azure.net/.default',
        grant_type: 'client_credentials',
        client_assertion_type:
          'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      }),
    }
  )

  if (!tokenResponse.ok) {
    throw new Error(
      `Azure identity authentication failed: HTTP ${tokenResponse.status}`
    )
  }

  const { access_token } = await tokenResponse.json()

  const secretResponse = await fetch(
    `${VAULT_URL}/secrets/${SECRET_NAME}?api-version=7.4`,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  )

  if (!secretResponse.ok) {
    throw new Error(
      `Key Vault access failed: HTTP ${secretResponse.status}`
    )
  }

  const secret = await secretResponse.json()

  if (!secret.value) {
    throw new Error('MongoDB password is missing')
  }

  return secret.value
}

async function main() {
  console.log('MongoTask secure startup initiated')

  await fs.access(MONGO_CA_FILE)

  const password = await getMongoPassword()

  const username = encodeURIComponent('mongotask_app')
  const encodedPassword = encodeURIComponent(password)

  const tlsOptions = new URLSearchParams({
    authSource: 'mongotask',
    tls: 'true',
    tlsCAFile: MONGO_CA_FILE,
  })

  process.env.TODO_MONGO_DB = 'mongotask'

  process.env.TODO_MONGO_CONNSTR =
    `mongodb://${username}:${encodedPassword}@${MONGO_HOST}:27017/mongotask?${tlsOptions}`

  console.log('MongoDB configuration loaded securely')
  console.log('Starting Node.js application')

  await import('./server.mjs')
}

main().catch(() => {
  console.error('Secure application startup failed')
  process.exit(1)
})