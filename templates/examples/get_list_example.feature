Feature: 用户列表接口测试

  Background:
    * url 'http://localhost:8080'
    # cookie 变量由 karate-config.js 注入，无需在脚本内定义
    * configure headers = { 'Cookie': '#(cookie)' }

  Scenario: 获取用户列表 - 默认分页
    Given path '/api/user/list'
    And param pageNum = 1
    And param pageSize = 10
    When method get
    Then status 200
    
    # 基础断言
    * match response.code == 0
    * match response.message == 'success'
    
    # 列表数据断言
    * match response.data.list == '#[_ > 0]'
    * match each response.data.list contains { userId: '#number', username: '#string', status: '#number' }
    
    # 分页信息断言
    * match response.data.total == '#number'
    * match response.data.pageNum == 1
    * match response.data.pageSize == 10

  Scenario: 获取用户列表 - 带状态过滤
    Given path '/api/user/list'
    And param pageNum = 1
    And param pageSize = 10
    And param status = 1
    When method get
    Then status 200
    * match response.code == 0
    * match each response.data.list contains { status: 1 }
