(namespace "free")

(module iface-after GOVERNANCE
  @doc "After version for interface-diff tests — breaking changes"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (implements my-interface)

  (defschema account
    balance:decimal
    owner:string)

  (deftable accounts:{account})

  (defun get-balance:decimal (account:string)
    @doc "Get balance"
    (at 'balance (read accounts account)))

  ; transfer signature CHANGED — extra parameter
  (defun transfer:string (from:string to:string amount:decimal memo:string)
    @doc "Transfer with memo"
    "ok")

  ; new defun ADDED
  (defun burn:string (account:string amount:decimal)
    @doc "Burn tokens"
    "ok")

  (defcap TRANSFER (from:string to:string amount:decimal)
    true)

  ; cross-transfer REMOVED — breaking
)
