// ==UserScript==
// @name         学堂在线视频自动学习面板脚本
// @namespace    http://tampermonkey.net/
// @version      1.4
// @license      MIT
// @description  为学堂在线(xuetangx.com/learn/)提供一个操作面板，可识别视频数量，选择起始章节，并强制自动播放/2.0倍速/静音/跳转；通过左侧小饼图判断是否完成，未满则自动重播。
// @author       Yangkunlong + ChatGPT
// @match        *://www.xuetangx.com/learn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 全局变量 ---
    var index = 0;
    var runIt;
    var lists;                // 存储所有章节列表元素（class="third"）
    var dragElement;          // 存储操作面板的DOM元素
    var replayCountMap = {};  // 每节的重播次数，防止死循环
    var isCheckingProgress = false; // 防止重复触发当前节的进度检查

    // --- UI/操作面板 相关函数 ---

    /**
     * 构建操作面板的HTML和CSS，并使其可拖动
     */
    function createPanel() {
        // CSS 样式
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

        // 插入 CSS
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = panelStyle;
        document.head.appendChild(styleSheet);

        // HTML 结构
        const panelHTML = `
            <div id="gemini-panel-header">
                🚀 学堂在线自动学习面板
            </div>
            <div style="padding: 10px;">
                <p><strong>已识别章节数: </strong><span id="video-count">加载中...</span></p>
                <div style="margin-bottom: 15px; margin-top: 10px;">
                    <label for="start-select" style="display: block; font-weight: bold;">选择起始章节:</label>
                    <select id="start-select" style="width: 100%; padding: 7px; margin-top: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></select>
                </div>
                <button id="start-automation" style="width: 100%; padding: 10px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    ▶️ 从所选章节开始自动学习
                </button>
                <p style="margin-top: 10px; font-size: 12px; color: #666; text-align: center;">
                    * 自动 2.0 倍速、静音，每 5 秒检查一次进度。饼图未满则自动重播本节。
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

    /**
     * 将状态信息输出到面板上的状态框
     * @param {string} msg - 要显示的文本
     */
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

        // 自动滚动到底部
        box.scrollTop = box.scrollHeight;
    }

    /**
     * 实现面板拖动功能
     */
    function makeDraggable(element) {
        var header = document.getElementById("gemini-panel-header");
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        if (header) {
            header.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    /**
     * 填充选择框并绑定事件
     */
    function populatePanel() {
        try {
            lists = document.getElementsByClassName("third");

            const videoCountSpan = document.getElementById("video-count");
            const startSelect = document.getElementById("start-select");
            const startButton = document.getElementById("start-automation");

            if (lists.length === 0) {
                videoCountSpan.innerText = "0 (未找到章节，请检查类名 'third')";
                logStatus("未找到任何章节元素，可能页面结构有变化。");
                startSelect.innerHTML = '<option value="-1">未找到视频列表</option>';
                startButton.disabled = true;
                return;
            }

            videoCountSpan.innerText = lists.length;
            startSelect.innerHTML = '';
            logStatus("已识别到 " + lists.length + " 个章节。");

            // 填充选择框
            for (let i = 0; i < lists.length; i++) {
                const temp = lists[i].getElementsByTagName("li");
                let titleText = "无法获取标题";

                if (temp.length > 0) {
                    const titleSpan = temp[0].getElementsByTagName("span");
                    titleText = titleSpan.length > 0 ? titleSpan[0].innerText.trim() : "无标题";
                }

                const option = document.createElement("option");
                option.value = i;
                option.innerText = `[#${i}] ${titleText}`;
                startSelect.appendChild(option);
            }

            // 绑定开始按钮事件
            startButton.onclick = () => {
                const selectedIndex = parseInt(startSelect.value);
                if (!isNaN(selectedIndex) && selectedIndex >= 0) {
                    console.log(`用户选择从章节 #${selectedIndex} 开始。`);
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

    // --- 核心自动化逻辑函数 ---

    /**
     * 根据索引启动某个章节的播放 (模拟点击)
     * @param {number} num - 章节索引
     */
    function startNum(num) {
        lists = document.getElementsByClassName("third");

        if (num >= lists.length) {
            console.log("所有章节播放完毕！脚本停止。");
            logStatus("所有章节播放完毕，脚本停止。");
            window.clearInterval(runIt);
            alert("所有章节播放完毕！");
            return;
        }

        index = num;
        var currentList = lists[index];
        var temp = currentList.getElementsByTagName("li");

        if (temp.length > 0) {
            temp[0].click();

            var titleSpan = temp[0].getElementsByTagName("span");
            var titleText = titleSpan.length > 0 ? titleSpan[0].innerText.trim() : "无标题";

            console.log("当前章节编号：" + index + ", 章节标题：" + titleText);
            logStatus("正在播放章节 #" + index + " - " + titleText);
            start();
        } else {
            console.log("章节 #" + index + " 中未找到 'li' 元素。尝试跳过。");
            logStatus("章节 #" + index + " 没有有效视频节点，尝试跳到下一节。");
            setTimeout(function() { startNum(++index); }, 1000);
        }
    }

    /**
     * 开始/设置定时器检查进度
     */
    function start() {
        console.log("播放检查/启动----");
        window.clearInterval(runIt);
        runIt = setInterval(next, 5000); // 每5秒检查一次
    }

    /**
     * 定时器触发函数：检查播放进度，进行下一节跳转
     */
    function next() {
        var videos = document.getElementsByClassName("xt_video_player");
        var video = videos.length > 0 ? videos[0] : undefined;

        // --- 视频播放器不存在，可能是作业或讨论 ---
        if (video === undefined) {
            console.log("未找到视频播放器，可能是作业/讨论，跳转下一个章节：" + (index + 1));
            logStatus("当前章节不是视频（可能是作业/讨论），跳到下一节 #" + (index + 1) + "。");
            startNum(++index);
            return;
        }

        var c = video.currentTime;
        var d = video.duration;

        // 视频时长无效或仍在加载中
        if (!isFinite(d) || d < 1) {
            console.log("视频时长无效或仍在加载中，等待加载...");
            logStatus("视频时长未正确获取，等待加载中...");
            if (video.paused) {
                video.play().catch(function(error) {
                    console.log("尝试播放失败 (可能需要用户交互)：", error.name);
                    logStatus("尝试播放视频失败，可能需要手动点一下播放按钮。");
                });
            }
            return;
        }

        // 自动设置 2.0 倍速
        speed(video);

        // 关闭声音
        soundClose();

        // 强制播放（如果被暂停）
        if (video.paused) {
            console.log("检测到视频暂停，尝试强制播放...");
            logStatus("检测到视频暂停，尝试继续播放当前章节。");

            video.play().catch(function(error) {
                console.log("视频强制播放失败，可能需要用户交互。错误类型:", error.name);
                logStatus("强制播放失败，可能需要你手动点一下播放按钮。");
            });

            var staNow = document.getElementsByClassName("play-btn-tip")[0];
            if (staNow && staNow.innerText === "播放") {
                staNow.click();
            }
        }

        // 视频播放进度检查
        var ratio = c / d;
        var percentText = (ratio * 100).toFixed(2) + "%";

        if (ratio > 0.99) {
            // 防止重复触发同一节的检查
            if (isCheckingProgress) {
                return;
            }
            isCheckingProgress = true;

            console.log("本节视频已看完，观看百分比：" + percentText + "，准备检查小饼图进度...");
            logStatus("本节视频已看完（" + percentText + "），正在检查左侧饼图是否已满...");
            checkProgressAndMaybeGotoNext(video);
        } else {
            console.log("视频正在播放中... 进度: " + percentText);
        }
    }

    /**
     * 检查当前章节的小饼图是否满，如果没满就重播当前视频
     * @param {HTMLVideoElement} video - 当前视频元素
     */
    function checkProgressAndMaybeGotoNext(video) {
        // 给一点时间让页面刷新进度（如有异步更新）
        setTimeout(function() {
            lists = document.getElementsByClassName("third");

            var currentList = lists[index];
            if (!currentList) {
                console.log("找不到当前章节节点，直接跳到下一节 index =", index + 1);
                logStatus("找不到当前章节节点，直接跳到下一节 #" + (index + 1) + "。");
                isCheckingProgress = false;
                startNum(++index);
                return;
            }

            var lis = currentList.getElementsByTagName("li");
            if (lis.length === 0) {
                console.log("当前章节下没有 li，直接跳到下一节 index =", index + 1);
                logStatus("当前章节没有 li 节点，直接跳到下一节 #" + (index + 1) + "。");
                isCheckingProgress = false;
                startNum(++index);
                return;
            }

            var currentLi = lis[0];

            // 检查是否有满进度的 icon
            var fullIcon = currentLi.querySelector(".percentFull");

            if (fullIcon) {
                console.log("检测到当前章节饼图已满，跳转到下一节。index =", index + 1);
                logStatus("当前章节已被标记为“已完成”，跳转到下一节 #" + (index + 1) + "。");
                replayCountMap[index] = 0;
                isCheckingProgress = false;
                startNum(++index);
            } else {
                // 没有 percentFull，说明这节没被认定看完，再播一遍
                replayCountMap[index] = (replayCountMap[index] || 0) + 1;
                console.log("当前章节饼图未满，第 " + replayCountMap[index] + " 次重播当前章节 index =", index);
                logStatus("当前章节饼图未满，第 " + replayCountMap[index] + " 次重播当前章节。");

                // 防止死循环（如该节需要做题等，不只是看视频）
                if (replayCountMap[index] > 3) {
                    console.log("本章节重复播放超过 3 次仍未满，可能需要作答/手动操作，强制跳到下一节。");
                    logStatus("本章节重播超过 3 次仍未完成，可能需要答题/手动操作，强制跳到下一节。");
                    isCheckingProgress = false;
                    startNum(++index);
                    return;
                }

                if (video) {
                    video.currentTime = 0;
                    video.play().catch(function(error) {
                        console.log("重播当前视频失败，可能需要用户交互，错误类型:", error.name);
                        logStatus("重播当前视频失败，可能需要你手动点一下播放。");
                    });
                    // 重播当前章节后继续用 next() 的定时器检测即可
                } else {
                    console.log("重播失败：未找到视频元素，直接尝试下一节。");
                    logStatus("未找到视频元素，直接跳到下一节 #" + (index + 1) + "。");
                    startNum(++index);
                }

                isCheckingProgress = false;
            }
        }, 3000);
    }

    /**
     * 关闭视频声音 (通过点击 UI 按钮)
     */
    function soundClose() {
        var mutedIcon = document.getElementsByClassName("xt_video_player_common_icon_muted");
        if (mutedIcon.length === 0) {
            var muteButton = document.getElementsByClassName("xt_video_player_common_icon")[0];
            if (muteButton) {
                muteButton.click();
                console.log("视频声音关闭");
            }
        }
    }

    /**
     * 设置播放速度为2.0 (直接操作 video 元素)
     * @param {HTMLVideoElement} video - 视频DOM元素
     */
    function speed(video) {
        if (video && video.playbackRate !== 2.0) {
            video.playbackRate = 2.0;
            console.log("设置播放速度为 2.0 倍。");
        }
    }

    // --- 脚本启动入口 ---

    function main() {
        console.log("油猴脚本已启动，开始加载操作面板...");
        createPanel();
        logStatus("脚本已载入，正在识别章节列表...");
        setTimeout(populatePanel, 3000);
    }

    // 延迟执行主函数，等待页面元素加载
    setTimeout(main, 2000);
})();
