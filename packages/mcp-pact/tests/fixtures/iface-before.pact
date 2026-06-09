(namespace "free")

(module iface-before GOVERNANCE
  @doc "Before version for interface-diff tests"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (implements my-interface)

  (defschema account
    balance:decimal)

  (deftable accounts:{account})

  (defun get-balance:decimal (account:string)
    @doc "Get balance"
    (at 'balance (read accounts account)))

  (defun transfer:string (from:string to:string amount:decimal)
    @doc "Transfer amount between accounts"
    "ok")

  (defcap TRANSFER (from:string to:string amount:decimal)
    true)

  (defpact cross-transfer (from:string to:string amount:decimal)
    (step "a")
    (step "b"))
)
