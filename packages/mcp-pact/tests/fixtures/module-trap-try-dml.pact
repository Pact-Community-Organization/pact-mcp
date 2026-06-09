(namespace "free")

(module module-trap-try-dml GOVERNANCE
  @doc "Module demonstrating DML in try block trap"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defschema test-schema
    value:string)

  (deftable test-table:{test-schema})

  (defun bad-try-write:string (key:string value:string)
    @doc "Demonstrates DML in try block trap"
    ;; [Developer] This is a TRAP - DML not allowed in try (read-only)
    (try 
      (write test-table key {"value": value})
      "Failed to write"))

  (defun good-safe-read:object (key:string)
    @doc "Correct way to handle reads safely"
    (with-default-read test-table key {"value": "default"}
      {"value": value}
      {"value": value}))
)