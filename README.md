# PrintPitt · indexer (Envio, BLZ-20)

Envio HyperIndex 3.14 for `FotokopiKilat` + `TestIDRX`. Decision: repo `PrintPitt/vault`, Decision Log D-16.
Live game events still go over a WebSocket straight to the RPC. This indexer serves the snapshot when the FE opens,
order history, the per-session revenue leaderboard, customer profiles (NFTs, refunds) and tIDRX top-ups.

## Contents

- `config.yaml`: Monad testnet 10143 via HyperSync, anvil 31337 via RPC.
- `schema.graphql`: Order, Toko (shop), Sesi (session), OmzetSesi (revenue per session), Pelanggan (customer), TopUp, Katalog (catalog), Statistik (stats).
- `src/handlers/`: one file per contract.
- `abis/`: written by `script/export.mjs` in the `PrintPitt/contracts` repo (cloned next to this one). Do not edit by hand.

Entity and field names are in Indonesian and are kept as-is because the frontend queries them.

## Commands

```bash
npm install
npm run codegen     # required after cloning (.envio/types.d.ts is not committed) and after config.yaml / schema.graphql change
npm run typecheck
npm test            # simulated events, no Docker and no network
npm run dev         # local indexer + GraphQL at http://localhost:8080, NEEDS Docker (OrbStack)
```

`npm run dev` indexes both chains. For testnet, fill `.env` from `.env.example`
(`ENVIO_API_TOKEN`, `ENVIO_FK_ADDRESS`, `ENVIO_TIDRX_ADDRESS`, `ENVIO_START_BLOCK`) after the BLZ-07 deploy.

## Example FE query

```graphql
query Papan($sesi: String!) {
  OmzetSesi(where: { sesi_id: { _eq: $sesi } }, order_by: { omzet: desc }) { toko { nama } omzet selesai }
  Order(where: { status: { _in: ["Open", "Claimed"] } }, order_by: { dibuatPada: asc }) { id label teks harga status toko_id dibuatPada }
}
```
