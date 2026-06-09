(module clean GOVERNANCE
  @doc "Clean file — should pass fmt_check"
  (defcap GOVERNANCE () true)
  (defun foo:string () "bar")
)
