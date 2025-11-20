// ==UserScript==
// @name         学堂在线视频自动学习面板脚本 (修正误判版)
// @namespace    http://tampermonkey.net/
// @version      1.6.4
// @license      MIT
// @description  为学堂在线(xuetangx.com/learn/)提供一个操作面板，只播放左侧“饼图未满”的章节；自动 2.0 倍速、静音、循环播放，直到饼图满再跳下一节。已移除不稳定的类名检测，仅跳过标题包含“习题/作业”的章节。
// @author       Yangkunlong + ChatGPT + Gemini
// @match        *://www.xuetangx.com/learn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 全局变量 ---
    var index = 0;                  // 当前正在播放的章节索引（对应 lists 的下标）
    var runIt;                      // 定时器
    var lists;                      // 左侧章节列表（class="third"）
    var dragElement;                // 操作面板 DOM
    var replayCountMap = {};        // 每节的重播次数，防止死循环
    var isCheckingProgress = false; // 防止重复触发当前节的进度检查
    var pendingCheckIndex = null;   // 记录哪一节需要在切章后检查饼图
    var isRefreshingPie = false;    // 正在“切章刷新饼图”的过程中，避免重复触发

    // --- 核心判断函数：是否跳过该章节（作业/习题） ---

    /**
     * 判断某个 li 元素是否属于需要跳过的类型
     * 修正：只判断标题文字，不判断 class="noScore"，防止误杀视频
     */
    function isSkipChapter(liElement) {
        if (!liElement) return false;

        // 尝试获取标题元素 (.titlespan)
        var titleSpan = liElement.querySelector(".titlespan");
        
        // 如果找不到 titlespan，尝试找普通的 span（兼容性）
        if (!titleSpan) {
            var spans = liElement.getElementsByTagName("span");
            if (spans.length > 0) {
                titleSpan = spans[0];
            }
        }

        if (!titleSpan) return false; // 找不到标题，默认不跳过（安全策略）

        var text = titleSpan.innerText.trim();

        // 调试日志：你可以在控制台看到每个章节被判定为什么
        // console.log("检测章节: " + text);

        // 关键词黑名单
        if (text.includes("习题") || 
            text.includes("作业") || 
            text.includes("章测") || 
            text.includes("考试")) {
            return true;
        }

        return false;
    }

    // --- UI/操作面板 相关函数 ---

    function createPanel() {
        const panelStyle = `
            #gemini-automation-panel {
                position: fixed;
                top: 100px;
                right: 20px;
                width: 320px;
                background-color: #fff;
                border: 1px solid #ccc;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 9999;
                font-family: 'Microsoft YaHei', Arial, sans-serif;
                border-radius: 8px;
                overflow: hidden;
                font-size: 13px;
            }
            #gemini-panel-header {
                cursor: move;
                background-color: #007bff;
                color: white;
                padding: 10px;
                border-bottom: 1px solid #0056b3;
                font-weight: bold;
                user-select: none;
            }
            #gemini-automation-panel button {
                transition: background-color 0.3s;
            }
            #gemini-automation-panel button:hover {
                background-color: #1e7e34 !important;
            }
        `;

        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = panelStyle;
        document.head.appendChild(styleSheet);

        const panelHTML = `
            <div id="gemini-panel-header">
                🚀 学堂在线自动学习
            </div>
            <div style="padding: 10px;">
                <p><strong>待学视频数: </strong><span id="video-count">加载中...</span></p>
                <div style="margin-bottom: 15px; margin-top: 10px;">
                    <label for="start-select" style="display: block; font-weight: bold;">选择起始视频（已过滤作业）:</label>
                    <select id="start-select" style="width: 100%; padding: 7px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></select>
                </div>
                <button id="start-automation" style="width: 100%; padding: 10px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    ▶️ 从所选章节开始自动学习
                </button>
                <p style="margin-top: 10px; font-size: 12px; color: #666; text-align: center;">
                    * 2.0倍速、静音；自动跳过标题含“习题/作业”的章节；<br>饼图未满自动重播，满则跳下一节。
                </p>

                <div id="gemini-status"
                    style="margin-top: 8px; font-size: 12px; color: #333;
                           background: #f8f9fa; border-radius: 4px; padding: 6px;
                           max-height: 140px; overflow-y: auto; white-space: pre-line; border: 1px solid #e1e4e8;">
                    等待启动...
                </div>
            </div>
        `;

        const panel = document.createElement("div");
        panel.id = "gemini-automation-panel";
        panel.innerHTML = panelHTML;
        document.body.appendChild(panel);

        dragElement = panel;
        makeDraggable(panel);

        return panel;
    }

    function logStatus(msg) {
        var box = document.getElementById("gemini-status");
        if (!box) return;
        var time = new Date().toLocaleTimeString();
        var line = "[" + time + "] " + msg;
        if (box.textContent && box.textContent.trim() !== "") {
            box.textContent += "\n" + line;
        } else {
            box.textContent = line;
        }
        box.scrollTop = box.scrollHeight;
    }

    function makeDraggable(element) {
        var header = document.getElementById("gemini-panel-header");
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        if (header) { header.onmousedown = dragMouseDown; }
        function dragMouseDown(e) {
            e = e || window.event; e.preventDefault();
            pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup = closeDragElement; document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e = e || window.event; e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
        }
    }

    /**
     * 面板填充：过滤掉习题，只显示未完成的视频
     */
    function populatePanel() {
        try {
            lists = document.getElementsByClassName("third");
            const videoCountSpan = document.getElementById("video-count");
            const startSelect = document.getElementById("start-select");
            const startButton = document.getElementById("start-automation");

            if (lists.length === 0) {
                videoCountSpan.innerText = "0 (未找到章节)";
                logStatus("未找到任何章节元素，可能页面结构有变化。");
                startSelect.innerHTML = '<option value="-1">未找到视频列表</option>';
                startButton.disabled = true;
                return;
            }

            startSelect.innerHTML = '';
            let unfinishedCount = 0;

            for (let i = 0; i < lists.length; i++) {
                const temp = lists[i].getElementsByTagName("li");
                if (temp.length === 0) continue;
                const li = temp[0];

                // 1. 如果是习题/作业，跳过
                if (isSkipChapter(li)) {
                    // console.log("跳过作业: " + i);
                    continue;
                }

                // 2. 如果饼图已满，跳过
                const fullIcon = li.querySelector(".percentFull");
                if (fullIcon) {
                    continue;
                }

                unfinishedCount++;
                
                // 获取标题用于显示
                let titleText = "无法获取标题";
                const titleSpan = li.querySelector(".titlespan") || li.getElementsByTagName("span")[0];
                if (titleSpan) {
                    titleText = titleSpan.innerText.trim();
                }

                const option = document.createElement("option");
                option.value = i; 
                option.innerText = `[#${i}] ${titleText}`;
                startSelect.appendChild(option);
            }

            videoCountSpan.innerText = unfinishedCount;
            logStatus("检测到未完成视频数：" + unfinishedCount);

            if (unfinishedCount === 0) {
                startSelect.innerHTML = '<option value="-1">没有未完成的视频</option>';
                startButton.disabled = true;
                logStatus("没有检测到未完成的视频（可能所有未完成的都是习题，或已被过滤）。");
                return;
            } else {
                startButton.disabled = false;
            }

            startButton.onclick = function() {
                const selectedValue = startSelect.value;
                const selectedIndex = parseInt(selectedValue, 10);
                if (!isNaN(selectedIndex) && selectedIndex >= 0) {
                    console.log("用户选择从章节 #", selectedIndex, " 开始。");
                    logStatus("开始自动学习，从章节 #" + selectedIndex + " 开始。");
                    window.clearInterval(runIt);
                    index = selectedIndex;
                    startNum(selectedIndex);
                } else {
                    alert("请选择一个有效的起始章节！");
                }
            };
        } catch (e) {
            console.error("面板初始化失败:", e);
            logStatus("面板初始化失败：" + e.message);
        }
    }

    // --- 播放列表控制 ---

    /**
     * 查找下一个：未完成 且 不是作业 的章节
     */
    function findNextUnfinished(startIndex) {
        lists = document.getElementsByClassName("third");
        for (let i = startIndex + 1; i < lists.length; i++) {
            const temp = lists[i].getElementsByTagName("li");
            if (temp.length === 0) continue;
            const li = temp[0];

            // 如果是作业，跳过
            if (isSkipChapter(li)) {
                continue;
            }

            // 如果饼图未满，则是目标
            const fullIcon = li.querySelector(".percentFull");
            if (!fullIcon) {
                return i;
            }
        }
        return -1;
    }

    function gotoNextUnfinished(currentIndex) {
        const nextIdx = findNextUnfinished(currentIndex);
        if (nextIdx === -1) {
            console.log("没有更多未完成的章节，脚本结束。");
            logStatus("没有更多未完成的视频，脚本结束。");
            window.clearInterval(runIt);
            alert("未完成的视频已全部播放完毕！");
            return;
        }
        startNum(nextIdx);
    }

    // --- 核心播放逻辑 ---

    function startNum(num) {
        lists = document.getElementsByClassName("third");

        if (num >= lists.length) {
            console.log("索引超出范围，结束。");
            logStatus("章节索引超出范围，结束。");
            window.clearInterval(runIt);
            return;
        }

        index = num;
        var currentList = lists[index];
        var temp = currentList.getElementsByTagName("li");

        if (temp.length > 0) {
            // 再次安全检查
            if (isSkipChapter(temp[0])) {
                console.log("检测到当前是作业章节 #" + index + "，跳过。");
                logStatus("跳过作业章节 #" + index + "。");
                gotoNextUnfinished(index);
                return;
            }

            temp[0].click();
            var titleSpan = temp[0].querySelector(".titlespan") || temp[0].getElementsByTagName("span")[0];
            var titleText = titleSpan ? titleSpan.innerText.trim() : "无标题";

            console.log("当前章节编号：" + index + ", 章节标题：" + titleText);
            logStatus("正在播放：" + titleText);
            start();
        } else {
            console.log("章节 #" + index + " 无效，跳过。");
            gotoNextUnfinished(index);
        }
    }

    function start() {
        window.clearInterval(runIt);
        runIt = setInterval(next, 5000); 
    }

    function next() {
        var videos = document.getElementsByClassName("xt_video_player");
        var video = videos.length > 0 ? videos[0] : undefined;

        if (video === undefined) {
            console.log("未找到视频播放器，尝试跳过。");
            // 如果当前确实不是视频（可能是误判），跳下一个
            gotoNextUnfinished(index);
            return;
        }

        var c = video.currentTime;
        var d = video.duration;

        if (!isFinite(d) || d < 1) {
            console.log("视频加载中...");
            logStatus("视频加载中...");
            if (video.paused) {
                video.play().catch(() => {});
            }
            return;
        }

        speed(video);
        soundClose();

        if (video.paused) {
            console.log("强制播放...");
            video.play().catch(() => {});
            var staNow = document.getElementsByClassName("play-btn-tip")[0];
            if (staNow && staNow.innerText === "播放") {
                staNow.click();
            }
        }

        var ratio = c / d;
        var percentText = (ratio * 100).toFixed(2) + "%";

        if (ratio > 0.99) {
            if (isRefreshingPie) return;
            isRefreshingPie = true;
            pendingCheckIndex = index;

            console.log("本节结束，切章刷新饼图...");
            logStatus("本节已看完 (" + percentText + ")，正在刷新状态...");
            switchChapterForPieRefresh();
        } else {
            console.log("播放中: " + percentText);
        }
    }

    /**
     * 为了刷新当前章节的饼图：临时切换到别的章节
     * 策略：先往回找最近的一个【非作业】视频；找不到则往后找。
     */
    function switchChapterForPieRefresh() {
        lists = document.getElementsByClassName("third");
        var jumpIndex = -1;

        // 1. 优先：向前查找最近的非作业章节
        for (let i = index - 1; i >= 0; i--) {
            let li = lists[i].getElementsByTagName("li")[0];
            if (!isSkipChapter(li)) {
                jumpIndex = i;
                break;
            }
        }

        // 2. 备选：如果前面没有，则向后查找
        if (jumpIndex === -1) {
            for (let i = index + 1; i < lists.length; i++) {
                let li = lists[i].getElementsByTagName("li")[0];
                if (!isSkipChapter(li)) {
                    jumpIndex = i;
                    break;
                }
            }
        }

        if (jumpIndex === -1) {
            logStatus("未找到可供跳转刷新的视频章节，直接检查。");
            checkProgressAndMaybeGotoNext(null);
            return;
        }

        // 执行临时跳转
        var list = lists[jumpIndex];
        var lis = list.getElementsByTagName("li");
        if (lis.length > 0) {
            lis[0].click();
            console.log("临时切到章节 #" + jumpIndex + " (非作业) 以刷新进度");
            logStatus("为刷新进度，暂时切换到章节 #" + jumpIndex + "...");
        }

        setTimeout(function() {
            checkProgressAndMaybeGotoNext(null);
        }, 3000);
    }

    function checkProgressAndMaybeGotoNext(video) {
        isCheckingProgress = false;
        lists = document.getElementsByClassName("third");

        if (pendingCheckIndex == null) {
            isRefreshingPie = false;
            return;
        }

        var currentList = lists[pendingCheckIndex];
        if (!currentList) {
            isRefreshingPie = false;
            gotoNextUnfinished(pendingCheckIndex);
            pendingCheckIndex = null;
            return;
        }

        var lis = currentList.getElementsByTagName("li");
        var currentLi = lis[0];
        var fullIcon = currentLi.querySelector(".percentFull");

        if (fullIcon) {
            console.log("章节 #" + pendingCheckIndex + " 饼图已满。");
            logStatus("章节 #" + pendingCheckIndex + " 完成，跳下一节。");
            replayCountMap[pendingCheckIndex] = 0;
            isRefreshingPie = false;
            var baseIndex = pendingCheckIndex;
            pendingCheckIndex = null;
            gotoNextUnfinished(baseIndex);
        } else {
            replayCountMap[pendingCheckIndex] = (replayCountMap[pendingCheckIndex] || 0) + 1;
            console.log("饼图未满，重播 #" + pendingCheckIndex + " (次数: " + replayCountMap[pendingCheckIndex] + ")");
            logStatus("饼图未更新，第 " + replayCountMap[pendingCheckIndex] + " 次重播...");

            index = pendingCheckIndex;
            pendingCheckIndex = null;
            isRefreshingPie = false;

            currentLi.click();

            setTimeout(function() {
                var videos = document.getElementsByClassName("xt_video_player");
                var v = videos.length > 0 ? videos[0] : null;
                if (v) {
                    v.currentTime = 0;
                    v.play().catch(() => {});
                }
                start();
            }, 1000);
        }
    }

    function soundClose() {
        var mutedIcon = document.getElementsByClassName("xt_video_player_common_icon_muted");
        if (mutedIcon.length === 0) {
            var muteButton = document.getElementsByClassName("xt_video_player_common_icon")[0];
            if (muteButton) muteButton.click();
        }
    }

    function speed(video) {
        if (video && video.playbackRate !== 2.0) {
            video.playbackRate = 2.0;
        }
    }

    function main() {
        console.log("油猴脚本启动...");
        createPanel();
        setTimeout(populatePanel, 3000);
    }

    setTimeout(main, 2000);
})();