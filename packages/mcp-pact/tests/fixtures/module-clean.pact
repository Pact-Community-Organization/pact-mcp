(namespace "free")

(module module-clean GOVERNANCE
  @doc "Clean Pact module with no critical traps"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defschema account-schema
    @doc "Account schema"
    balance:decimal)

  (deftable accounts:{account-schema})

  (defun get-balance:decimal (account:string)
    @doc "Get account balance"
    (at 'balance (read accounts account)))

  (defun transfer:string (from:string to:string amount:decimal)
    @doc "Transfer between accounts"  
    (with-capability (GOVERNANCE)
      (let ((from-bal (get-balance from))
            (to-bal (get-balance to)))
        (enforce (>= from-bal amount) "Insufficient balance")
        (update accounts from {"balance": (- from-bal amount)})
        (update accounts to {"balance": (+ to-bal amount)})
        "Transfer completed")))
)