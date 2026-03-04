#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
#
# This file is part of the distrobox project:
#    https://github.com/89luca89/distrobox
#
# Copyright (C) 2022 distrobox contributors
#
# distrobox is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License version 3
# as published by the Free Software Foundation.
#
# distrobox is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with distrobox; if not, see <http://www.gnu.org/licenses/>.

# Based on https://github.com/89luca89/distrobox/blob/main/distrobox-host-exec

# Ensure we have our env variables correctly set
[ -z "${USER}" ] && USER="$(id -run)"
[ -z "${HOME}" ] && HOME="$(getent passwd "${USER}" | cut -d':' -f6)"
[ -z "${SHELL}" ] && SHELL="$(getent passwd "${USER}" | cut -d':' -f7)"

# Defaults
host_command=""

# If we're a symlink to a command, use that as command to exec, and skip arg parsing.
if [ "$(basename "${0}")" != "host-exec" ]; then
	host_command="$(basename "${0}")"
else
  host_command="${1}"
  shift
fi

set -o errexit
set -o nounset

# Check we're running inside a container and not on the host
if [ ! -f /run/.containerenv ] && [ ! -f /.dockerenv ] && [ -z "${container:-}" ]; then
	printf >&2 "You must run %s inside a container!\n" " $(basename "$0")"
	exit 126
fi

if [ -z "${host_command}" ]; then
	echo -e "Usage: $(basename "$0") <command> [args...]\n"
	exit 1
fi

# This makes host-spawn work on initful containers, where the dbus session is
# separate from the host, we point the dbus session straight to the host's socket
# in order to talk with the org.freedesktop.Flatpak.Development.HostCommand on the host
[ -z "${XDG_RUNTIME_DIR:-}" ] && XDG_RUNTIME_DIR="/run/user/$(id -ru)"
[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -ru)/bus"
XDG_RUNTIME_DIR="/run/host/${XDG_RUNTIME_DIR}"
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/host/$(echo "${DBUS_SESSION_BUS_ADDRESS}" | cut -d '=' -f2-)"

opts=""

###
# This workaround is needed because of a bug in gio (used by xdg-open) where
# a race condition happens when allocating a pty, leading to the command
# being killed before having time to be executed.
#
# https://gitlab.gnome.org/GNOME/glib/-/issues/2695
# https://github.com/1player/host-spawn/issues/7
#
# As an (ugly) workaround, we will not allocate a pty for those commands.
###
# Also, we don't initialize a pty, if we're not in a tty.
if [ "$(basename "${host_command}")" = "xdg-open" ] ||
	[ "$(basename "${host_command}")" = "gio" ] ||
	[ "$(basename "${host_command}")" = "flatpak" ] ||
	[ ! -t 1 ] ||
	! tty > /dev/null 2>&1; then

  opts="${opts} --no-pty"
fi

# Propagate environment variables
ignore_vars="CONTAINER_ID|DBUS_SESSION_BUS_ADDRESS|PATH|PWD|SHELL|SHLVL|USER|XDG_RUNTIME_DIR|container|_"
env_vars=$(env | cut -d'=' -f1 | grep -Ev "^(${ignore_vars})$" | tr '\n' ',' | sed 's/,$//')
if [ -n "${env_vars}" ]; then
  opts="${opts} --env ${env_vars}"
fi

exec host-spawn ${opts} "${host_command}" "$@"
