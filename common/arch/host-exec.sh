#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
#
# This file is part of the distrobox project:
#    https://github.com/89luca89/distrobox
#
# Copyright (C) 2022 distrobox contributors
#
# distrobox is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License version 3 as published by
# the Free Software Foundation.

[ -z "${USER}" ] && USER="$(id -run)"
[ -z "${HOME}" ] && HOME="$(getent passwd "${USER}" | cut -d':' -f6)"
[ -z "${SHELL}" ] && SHELL="$(getent passwd "${USER}" | cut -d':' -f7)"

host_command=""
if [ "$(basename "${0}")" != "host-exec" ]; then
  host_command="$(basename "${0}")"
else
  host_command="${1}"
  shift
fi

set -eu

if [ ! -f /run/.containerenv ] && [ ! -f /.dockerenv ] && [ -z "${container:-}" ]; then
  printf >&2 'You must run %s inside a container!\n' "$(basename "$0")"
  exit 126
fi

if [ -z "${host_command}" ]; then
  printf 'Usage: %s <command> [args...]\n' "$(basename "$0")"
  exit 1
fi

[ -n "${XDG_RUNTIME_DIR:-}" ] || XDG_RUNTIME_DIR="/run/user/$(id -ru)"
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -ru)/bus"
XDG_RUNTIME_DIR="/run/host/${XDG_RUNTIME_DIR}"
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/host/$(printf '%s' "${DBUS_SESSION_BUS_ADDRESS}" | cut -d '=' -f2-)"

opts=""
if [ "$(basename "${host_command}")" = "xdg-open" ] ||
  [ "$(basename "${host_command}")" = "gio" ] ||
  [ "$(basename "${host_command}")" = "flatpak" ] ||
  [ ! -t 1 ] || ! tty >/dev/null 2>&1; then
  opts="${opts} --no-pty"
fi

ignore_vars="CONTAINER_ID|DBUS_SESSION_BUS_ADDRESS|PATH|PWD|SHELL|SHLVL|USER|XDG_RUNTIME_DIR|container|_"
env_vars="$(env | cut -d'=' -f1 | grep -Ev "^(${ignore_vars})$" | tr '\n' ',' | sed 's/,$//')"
if [ -n "${env_vars}" ]; then
  opts="${opts} --env ${env_vars}"
fi

# shellcheck disable=SC2086
exec host-spawn ${opts} "${host_command}" "$@"
