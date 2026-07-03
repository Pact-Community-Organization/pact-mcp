(namespace "free")

(module module-trap-shadow GOVERNANCE
  @doc "Module demonstrating built-in function name shadowing trap"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defun bad-shadowing:decimal (value:decimal)
    @doc "Demonstrates built-in name shadowing trap"
    ;; This is a TRAP - 'exp' shadows built-in function  
    (let ((exp 2.71828)
          (abs -5))
      ;; Built-in functions are now shadowed
      (+ exp abs)))

  (defun good-naming:decimal (value:decimal)
    @doc "Correct way to name variables"
    (let ((expVal 2.71828)
          (absVal -5))
      (+ expVal absVal)))
)