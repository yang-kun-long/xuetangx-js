// ==UserScript==
// @name         学堂在线视频自动学习面板脚本 
// @namespace    http://tampermonkey.net/
// @version      1.3
// @license MIT
// @description  为学堂在线(xuetangx.com/learn/)提供一个操作面板，可识别视频数量，选择起始章节，并强制自动播放/2.0倍速/静音/跳转。
// @author       Yangkunlong
// @match        *://www.xuetangx.com/learn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 全局变量 ---
    var index = 0;
    var runIt;
    var lists; // 存储所有章节列表元素
    var dragElement; // 存储操作面板的DOM元素


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
                width: 300px;
                background-color: #fff;
                border: 1px solid #ccc;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 9999;
                font-family: 'Microsoft YaHei', Arial, sans-serif;
                border-radius: 8px;
                overflow: hidden;
            }
            #gemini-panel-header {
                cursor: move;
                background-color: #007bff;
                color: white;
                padding: 10px;
                border-bottom: 1px solid #0056b3;
                font-weight: bold;
                user-select: none; /* 防止拖动时选中文字 */
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
                🚀 学堂在线自动学习面板 (v1.2)
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
                    * 脚本自动设置 2.0 倍速，静音，并自动跳转 (5秒检查一次)。
                </p>
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
            // 获取鼠标光标的初始位置
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            // 计算新的光标位置
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            // 设置元素的新位置，并确保不超出窗口
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
        // 使用 try...catch 确保即使元素未找到也不会中断脚本
        try {
            lists = document.getElementsByClassName("third");

            const videoCountSpan = document.getElementById("video-count");
            const startSelect = document.getElementById("start-select");
            const startButton = document.getElementById("start-automation");

            if (lists.length === 0) {
                videoCountSpan.innerText = "0 (未找到章节，请检查类名'third')";
                startSelect.innerHTML = '<option value="-1">未找到视频列表</option>';
                startButton.disabled = true;
                return;
            }

            videoCountSpan.innerText = lists.length;
            startSelect.innerHTML = ''; // 清空选项

            // 填充选择框
            for(let i = 0; i < lists.length; i++){
                const temp = lists[i].getElementsByTagName("li");
                let titleText = "无法获取标题";

                if (temp.length > 0) {
                    const titleSpan = temp[0].getElementsByTagName("span");
                    // 尝试获取标题，如果获取不到则保持默认
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
                    window.clearInterval(runIt); // 清除旧的定时器
                    startNum(selectedIndex); // 从选定章节开始运行
                } else {
                    alert("请选择一个有效的起始章节！");
                }
            };
        } catch (e) {
            console.error("面板初始化失败:", e);
        }
    }


    // --- 核心自动化逻辑函数 ---

    /**
     * 根据索引启动某个章节的播放 (模拟点击)
     * @param {number} num - 章节索引
     */
    function startNum(num){
        lists = document.getElementsByClassName("third");

        if (num >= lists.length) {
            console.log("所有章节播放完毕！脚本停止。");
            window.clearInterval(runIt);
            alert("所有章节播放完毕！");
            return;
        }

        index = num;
        var currentList = lists[index];
        var temp = currentList.getElementsByTagName("li");

        if (temp.length > 0) {
            // 模拟点击章节/视频链接
            temp[0].click();

            var titleSpan = temp[0].getElementsByTagName("span");
            var titleText = titleSpan.length > 0 ? titleSpan[0].innerText.trim() : "无标题";

            console.log("当前章节编号：" + index + ", 章节标题：" + titleText);
            start();
        } else {
            console.log("章节 #" + index + " 中未找到 'li' 元素。尝试跳过。");
            setTimeout(() => startNum(++index), 1000); // 延迟1秒尝试跳到下一节
        }
    }

    /**
     * 开始/设置定时器检查进度
     */
    function start(){
        console.log("播放检查/启动----");
        window.clearInterval(runIt);
        runIt = setInterval(next, 5000); // 每5秒检查一次
    }

    /**
     * 定时器触发函数：检查播放进度，进行下一节跳转
     */
    function next(){
        var videos = document.getElementsByClassName("xt_video_player");
        var video = videos.length > 0 ? videos[0] : undefined;

        // --- 视频播放器不存在，可能是作业或讨论 ---
        if(video === undefined){
            console.log("未找到视频播放器，可能是作业/讨论，5秒后跳转下一个视频，下一节编号：" + (index + 1));
            startNum(++index);
            return;
        }

        var c = video.currentTime;
        var d = video.duration;

        // 视频时长无效或仍在加载中
        if (!isFinite(d) || d < 1) {
             console.log("视频时长无效或仍在加载中，等待视频加载...");

             // 尝试强制播放，可能在加载完成后生效
             if (video.paused) {
                 video.play().catch(error => {
                     console.log("尝试播放失败 (可能需要用户交互)：", error.name);
                 });
             }
             return;
        }

        // --- 核心自动化操作 ---

        // 1. 强制设置 2.0 倍速 (直接操作 video 元素)
        speed(video);

        // 2. 关闭声音
        soundClose();

        // 3. 强制播放（如果被暂停）
        if (video.paused) {
            console.log("检测到视频暂停，尝试强制播放...");
            // 使用 play() 方法比模拟点击更可靠
            video.play().catch(error => {
                 console.log("视频强制播放失败，可能需要用户交互。错误类型:", error.name);
            });

            // 额外尝试点击播放按钮，作为 play() 的备用方案
            var staNow = document.getElementsByClassName("play-btn-tip")[0];
            if(staNow && staNow.innerText === "播放"){
                 staNow.click();
            }
        }


        // 4. 视频播放进度检查与跳转
        // 确保进度检查发生在播放操作之后
        if((c / d) > 0.99){
            console.log("本节播放完毕，观看百分比：" + (c/d).toFixed(4) * 100 + "%");
            startNum(++index);
            console.log("跳转到下一节，下一节编号：" + index);
        } else {
             console.log("视频正在播放中... 进度: " + (c/d).toFixed(4) * 100 + "%");
        }
    }

    /**
     * 关闭视频声音 (通过点击 UI 按钮)
     */
    function soundClose(){
        // 尝试查找静音图标的类名 (xt_video_player_common_icon_muted 存在则已静音)
        var mutedIcon = document.getElementsByClassName("xt_video_player_common_icon_muted");
        if(mutedIcon.length === 0){
            // 如果没有静音图标，说明当前是播放状态，尝试点击静音按钮
            var muteButton = document.getElementsByClassName("xt_video_player_common_icon")[0];
            if(muteButton) {
                muteButton.click();
                console.log("视频声音关闭");
            }
        }
    }

    /**
     * 设置播放速度为2.0 (直接操作 video 元素)
     * @param {HTMLVideoElement} video - 视频DOM元素
     */
    function speed(video){
        // 直接设置 HTMLVideoElement 的播放速率属性
        if (video && video.playbackRate !== 2.0) {
            video.playbackRate = 2.0;
            console.log("设置播放速度为 2.0 倍 (通过 video.playbackRate)。");
        }
    }


    // --- 脚本启动入口 ---

    /**
     * 主函数：等待DOM加载完毕后执行主要逻辑
     */
    function main() {
        console.log("油猴脚本已启动，开始加载操作面板...");

        // 1. 创建并插入操作面板
        createPanel();

        // 2. 填充面板数据，等待 3 秒确保异步加载的章节列表出现
        setTimeout(populatePanel, 3000);
    }

    // 延迟执行主函数，等待页面元素加载
    setTimeout(main, 2000);
})();