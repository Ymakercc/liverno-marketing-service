### 接入步骤
> 第一步：创建应用
>

> 第二步：权限管理
>

> 第三步：获取accessToken
>

> 第四步：对accessToken做缓存处理
>

> 第五步：开发对接逻辑
>

### 第一步：创建应用
管理员登录孚盟MX网页端，进入<font style="background:#F8CED3;color:#70000D">设置</font>界面，点击<font style="background:#F8CED3;color:#70000D">开放平台</font>创建应用。

<font style="color:#8A8F8D;">详细请参考：</font>[创建应用](https://www.yuque.com/yangzhuzai/jiang/thf13ghdqd32rl4u?singleDoc#)

### 第二步：权限管理
<font style="color:rgb(23, 26, 29);">应用创建后，需要配置应用的对应权限例如IP白名单等。</font>

<font style="color:#8A8F8D;">详细请参考：</font>[权限管理](https://www.yuque.com/yangzhuzai/jiang/kn7mquxaitrprfa2?singleDoc#)

### 第三步：获取accessToken
<font style="color:rgb(51, 51, 51);">通过对应应用的配置信息获取</font>accessToken。

<font style="color:#8A8F8D;">详细请参考：</font>[获取accessToken](https://www.yuque.com/yangzhuzai/jiang/hek5dunmgi1cvvzl?singleDoc#)

### 第四步：对accessToken做缓存处理
<font style="color:rgb(51, 51, 51);">每个 accessToken 的有效期为7200秒（2小时），有效期内重复获取返回相同结果。所以为了防止因为频率调用次数超出限制而影响功能正常使用的问题，建议开发者将中间生成的 AccessToken  进行缓存，过期以后再重新获取。</font>

### <font style="color:rgb(51, 51, 51);">第五步：开发对接逻辑</font>
<font style="color:rgb(51, 51, 51);">准备工作已经就绪，开发对接程序前，</font>**<font style="color:rgb(51, 51, 51);">请务必先查看接口调用说明。</font>**

<font style="color:#8A8F8D;">详细请参考：</font>[接口调用说明](https://www.yuque.com/yangzhuzai/jiang/gqf3mpckyr28esz1?singleDoc#)

### 接口地址：
生产环境：[https://opengw.fumamx.com](http://opengw.fumamx.com/auth-server/open/acquire_token)
