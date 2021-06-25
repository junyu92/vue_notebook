# GDB Python

## First step - Loading scripts

* `source my_script.py`
* `gdb my_program -ex"source my_script.py"`
* Enable auto-load python-scripts
* Rename your script to `objfile-gdb.py`
* Fix security-related settings
* ...

## Value

## Basic

* `gdb.parse_and_eval(string)`

Parse expression, which must be a string, as an expression in the
current language, evaluate it, and return the result as a gdb.Value.

* `gdb.write(string [, stream])`

Print a string to GDB's paginated output stream.

## Interactive with BREAKPOINT

### `__init__`

`Function: Breakpoint.__init__ ([ source ][, function ][, label ][, line ], ][ internal ][, temporary ][, qualified ])`

The optional internal argument allows the breakpoint to become
invisible to the user. The breakpoint will neither be reported
when created, nor will it be listed in the output from info
breakpoints (but will be listed with the maint info breakpoints
command).

### `stop` method

If the method returns `True`, the inferior will be stopped at the
location of the breakpoint, otherwise the inferior will continue.

```python
class MyBreakpoint (gdb.Breakpoint):
      def stop (self):
        inf_val = gdb.parse_and_eval("foo")
        if inf_val == 3:
          return True
        return False
```

## Command

The following templete can be used to introduce a new command.

```python
class ShowAllPci(gdb.Command):
    def __init__ (self):
        super(ShowAllPci, self).__init__("show-all-pci", gdb.COMMAND_USER)

    def invoke (self, arg, from_tty):
        print(pci_dict)

ShowAllPci()
```

## Signal

## Pretty Printer


## Reference

> https://sourceware.org/gdb/onlinedocs/gdb/Python-API.html
> https://www.lse.epita.fr/lse-winter-day-2013/slides/gdb-python.pdf