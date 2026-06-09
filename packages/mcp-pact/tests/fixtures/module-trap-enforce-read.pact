(namespace "free")

(module module-trap-enforce-read GOVERNANCE
  @doc "Module demonstrating DB read in enforce trap"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defschema balance-schema
    amount:decimal)

  (deftable balances:{balance-schema})

  (defun bad-enforce-read:string (account:string threshold:decimal)
    @doc "Demonstrates DB read in enforce boolean expression trap"
    ;; [Developer] This is a TRAP - DB read in enforce boolean (read-only on chainweb)
    (enforce (>= (at 'amount (read balances account)) threshold) 
             "Insufficient balance")
    "Check passed")

  (defun good-enforce:string (account:string threshold:decimal)
    @doc "Correct way to enforce on DB values"
    (let ((balance (at 'amount (read balances account))))
      (enforce (>= balance threshold) "Insufficient balance")
      "Check passed"))
)