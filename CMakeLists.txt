###########################################################################
# Copyright (C) 2015-2026 IoT.bzh Company
#
# Author: José Bollo <jose.bollo@iot.bzh>
#
# $RP_BEGIN_LICENSE$
# Commercial License Usage
#  Licensees holding valid commercial IoT.bzh licenses may use this file in
#  accordance with the commercial license agreement provided with the
#  Software or, alternatively, in accordance with the terms contained in
#  a written agreement between you and The IoT.bzh Company. For licensing terms
#  and conditions see https://www.iot.bzh/terms-conditions. For further
#  information use the contact form at https://www.iot.bzh/contact.
# 
# GNU General Public License Usage
#  Alternatively, this file may be used under the terms of the GNU General
#  Public license version 3. This license is as published by the Free Software
#  Foundation and appearing in the file LICENSE.GPLv3 included in the packaging
#  of this file. Please review the following information to ensure the GNU
#  General Public License requirements will be met
#  https://www.gnu.org/licenses/gpl-3.0.html.
# $RP_END_LICENSE$
###########################################################################

CMAKE_MINIMUM_REQUIRED(VERSION 3.10)

project(afb-monitoring
	VERSION 0.99.0
	DESCRIPTION "Monitoring of afb-binder"
	HOMEPAGE_URL "https://github.com/redpesk-devtools/afb-monitoring")

include(GNUInstallDirs)

###########################################################################

set(MONITORING_INSTALL_DIR ${CMAKE_INSTALL_DATADIR}/afb-monitoring CACHE STRING "Path to install monitoring")

install(
  FILES

    src/AFB2.js
    src/AFB.js
    src/background-iot.bzh.jpeg
    src/cross.png
    src/down.png
    src/favicon.ico
    src/index.html
    src/iot-bzh-logo-small.png
    src/monitor2.html
    src/monitor2.js
    src/monitor-base.css
    src/monitor-demo.css
    src/monitor.html
    src/monitor.js
    src/monitor-pastel.css
    src/underscore-umd-min.js
    src/up.png

  DESTINATION
    ${MONITORING_INSTALL_DIR})
