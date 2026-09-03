# Devshell packages — plain nixpkgs attribute names, one per line.
# Edited by `xin add` / `xin remove`; readable by `xin list`.
#
# `git` is seeded by default: the devshell rewrites PATH, so without it `git`
# is "command not found" inside the shell. `xin remove git` to drop it.
{ pkgs }:

with pkgs; [
  git
  nodejs
]
